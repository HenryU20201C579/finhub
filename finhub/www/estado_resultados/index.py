import frappe
from frappe.utils import flt, getdate, nowdate, add_days, get_first_day, get_last_day, date_diff

ADMIN_ROLES = ("Finhub-Finanzas-Administrar",)
VIEW_ROLES = ("Finhub-Finanzas-Ver", "Finhub-Finanzas-Administrar")


def _safe_sql(query, params=None, as_dict=False, default=None):
    """Ejecuta SQL silenciando errores por tabla/columna inexistente.
    finhub es un hub nuevo: los DocTypes contables (Cuenta, Asiento Contable,
    Periodo Contable, etc.) y custom fields (custom_comision en Sales Invoice)
    aún no existen acá. Devolvemos un default razonable en ese caso para que
    la página siga cargando en modo 'sin datos' hasta que finanzas_corporativas
    (Ola 2) aterrice los DocTypes pendientes."""
    try:
        return frappe.db.sql(query, params or (), as_dict=as_dict)
    except Exception:
        frappe.db.rollback()
        if default is not None:
            return default
        if as_dict:
            return [frappe._dict()]
        return [[0]]


def _column_exists(table_name, column_name):
    try:
        return bool(frappe.db.sql(
            "SELECT 1 FROM information_schema.columns "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s AND COLUMN_NAME = %s LIMIT 1",
            (table_name, column_name)
        ))
    except Exception:
        frappe.db.rollback()
        return False


def _is_admin():
    roles = set(frappe.get_roles(frappe.session.user))
    return bool(roles.intersection(ADMIN_ROLES))


def _can_view():
    roles = set(frappe.get_roles(frappe.session.user))
    return bool(roles.intersection(VIEW_ROLES))


def _require_view():
    if not _can_view():
        frappe.throw(
            "Acceso denegado. Requiere uno de los roles: "
            + ", ".join(VIEW_ROLES),
            frappe.PermissionError,
        )


# Impuesto a la renta (regimen MYPE): 1.5% sobre ingresos netos
IMPUESTO_RENTA_PCT = 0.015

# IGV (Peru): 18%. Los montos en Sales Invoice (total, discount_amount, grand_total),
# Item Price (Compra estandar) y Caja Pedido vienen CON IGV incluido. El Excel de
# referencia del negocio lleva el P&L en base imponible (sin IGV), por lo que todos
# los valores se dividen por 1.18 antes de presentar y calcular el P&L.
IGV_RATE = 0.18


def _sin_igv(monto_con_igv):
    """Convierte un monto con IGV a su base imponible (sin IGV)."""
    return flt(monto_con_igv) / (1 + IGV_RATE)

# Mapeo de categorias de gasto (Categoria Gasto -> seccion del Estado de Resultados)
# Usa keywords (lowercase) para matching flexible.
CATEGORIAS_GASTO = [
    {"label": "Sueldos y Salarios", "keywords": ["salario", "planilla", "sueldo"]},
    {"label": "Administracion", "keywords": ["contador", "jesus contador", "admin"]},
    {"label": "Marketing", "keywords": ["meta ads", "asesoria marketing", "asesoría marketing"]},
    {"label": "Logistica", "keywords": ["shalom", "indriver", "empaque", "envases"]},
    {"label": "Ventas", "keywords": ["comision", "comisión"]},
    {"label": "Alquiler Oficina", "keywords": ["alquiler depa", "depa (608) oficina"]},
    {"label": "Alquiler Almacen", "keywords": ["alquiler 213", "almacen", "almacén"]},
    {"label": "Alquiler Tienda", "keywords": ["alquiler (tienda", "tienda (tienda", "alquiler tienda"]},
    {"label": "Servicios - Luz", "keywords": ["luz", "recibo de luz"]},
    {"label": "Servicios - Internet", "keywords": ["internet", "vps", "chatwoot vps", "erp vps", "inter depa", "inter dep", "inter tda", "inter tienda", "inter ofi", "inter alma"]},
    {"label": "Servicios - Agua", "keywords": ["agua"]},
    {"label": "Telefonia", "keywords": ["bitel", "entel", "claro", "iphone"]},
    {"label": "Promocion y Publicidad", "keywords": ["shopify", "publicidad", "promocion"]},
    {"label": "Caja Chica / Otros", "keywords": ["caja chica", "almuerzo", "desayuno", "imprevistos", "nps"]},
]

# Keywords para excluir movimientos que NO son gastos operacionales
# (prestamos, ordenes de compra de inventario, aportes de capital, etc.)
CATEGORIAS_EXCLUIR_GASTOS = [
    "prestamo", "préstamo",
    "orden compra", "orden de compra",
    "aporte capital", "aporte de capital",
    "pago proveedor mercader", "compra mercader",
]


def _es_gasto_excluido(categoria, descripcion=""):
    """Identifica movimientos de Finanzas Corporativas que no son gastos operacionales."""
    texto = f"{categoria or ''} {descripcion or ''}".lower().strip()
    for kw in CATEGORIAS_EXCLUIR_GASTOS:
        if kw in texto:
            return True
    # Ordenes de compra se identifican por prefijo de Frappe en descripcion
    if "oc: pur-ord" in texto or "acc-pinv" in texto:
        return True
    return False


def get_context(context):
    context.no_access = not _can_view()
    context.required_roles = list(VIEW_ROLES)
    context.can_edit = _is_admin()
    context.title = "Estado de Resultados"
    context.no_cache = 1


def _categorizar_gasto(nombre_categoria):
    """Devuelve el label del grupo del Estado de Resultados al que pertenece la categoria."""
    if not nombre_categoria:
        return "Caja Chica / Otros"
    nc = nombre_categoria.lower().strip()
    for grupo in CATEGORIAS_GASTO:
        for kw in grupo["keywords"]:
            if kw in nc:
                return grupo["label"]
    return "Caja Chica / Otros"


@frappe.whitelist()
def get_estado_resultados(start_date=None, end_date=None):
    """Retorna todos los datos para armar el Estado de Resultados en el rango dado."""
    _require_view()

    try:
        if not start_date or not end_date:
            today = getdate(nowdate())
            start_date = get_first_day(today)
            end_date = get_last_day(today)
        else:
            start_date = getdate(start_date)
            end_date = getdate(end_date)
            if end_date < start_date:
                start_date, end_date = end_date, start_date

        # Rango anterior del mismo largo para comparacion
        days_in_period = date_diff(end_date, start_date) + 1
        prev_end = add_days(start_date, -1)
        prev_start = add_days(prev_end, -(days_in_period - 1))

        # ============================================================
        # 1. VENTAS / DESCUENTOS / DEVOLUCIONES
        # ============================================================
        # Ventas brutas (facturas activas, sin returns)
        ventas_query = """
            SELECT IFNULL(SUM(si.total),0) as total_bruto,
                   IFNULL(SUM(si.discount_amount),0) as descuentos,
                   IFNULL(SUM(si.grand_total),0) as grand_total,
                   COUNT(*) as num_facturas
            FROM `tabSales Invoice` si
            WHERE si.docstatus = 1
              AND IFNULL(si.is_return,0) = 0
              AND si.posting_date BETWEEN %(start)s AND %(end)s
        """
        v = _safe_sql(ventas_query, {"start": start_date, "end": end_date}, as_dict=True)[0]
        ventas_brutas_con_igv = flt(v.total_bruto)
        descuentos_con_igv = flt(v.descuentos)
        ventas_brutas = _sin_igv(ventas_brutas_con_igv)
        descuentos = _sin_igv(descuentos_con_igv)

        # Devoluciones = suma absoluta de is_return + cancelaciones dentro del rango
        dev_return = _safe_sql("""
            SELECT IFNULL(SUM(ABS(grand_total)),0) as total
            FROM `tabSales Invoice`
            WHERE docstatus = 1 AND IFNULL(is_return,0) = 1
              AND posting_date BETWEEN %(start)s AND %(end)s
        """, {"start": start_date, "end": end_date}, as_dict=True)[0]
        dev_is_return = flt(dev_return.total)

        # Cancelaciones que afectan ingresos netos del periodo:
        # solo las facturas cuyo posting_date es ANTERIOR al periodo y se cancelaron dentro del periodo.
        # Las canceladas dentro del mismo periodo (posting_date in rango) ya estan excluidas de ventas_brutas
        # por el filtro docstatus=1, asi que restarlas otra vez seria doble descuento.
        dev_cancel = _safe_sql("""
            SELECT IFNULL(SUM(grand_total),0) as total
            FROM `tabSales Invoice`
            WHERE docstatus = 2
              AND DATE(modified) BETWEEN %(start)s AND %(end)s
              AND DATE(posting_date) < %(start)s
        """, {"start": start_date, "end": end_date}, as_dict=True)[0]
        dev_cancelaciones = flt(dev_cancel.total)

        dev_is_return_con_igv = dev_is_return
        dev_cancelaciones_con_igv = dev_cancelaciones
        dev_is_return = _sin_igv(dev_is_return_con_igv)
        dev_cancelaciones = _sin_igv(dev_cancelaciones_con_igv)
        devoluciones_con_igv = dev_is_return_con_igv + dev_cancelaciones_con_igv
        devoluciones = dev_is_return + dev_cancelaciones

        ingresos_netos = ventas_brutas - descuentos - devoluciones
        ingresos_netos_con_igv = ventas_brutas_con_igv - descuentos_con_igv - devoluciones_con_igv
        igv_sobre_ventas = ingresos_netos_con_igv - ingresos_netos

        # ============================================================
        # 2. COSTO DE VENTAS (COGS)
        # ============================================================
        cogs_query = """
            SELECT IFNULL(SUM(sii.qty * IFNULL(ip.price_list_rate, 0)), 0) as cogs
            FROM `tabSales Invoice Item` sii
            JOIN `tabSales Invoice` si ON si.name = sii.parent
            LEFT JOIN `tabItem Price` ip ON (ip.item_code = sii.item_code AND ip.price_list = 'Compra estandar')
            WHERE si.docstatus = 1
              AND IFNULL(si.is_return,0) = 0
              AND si.posting_date BETWEEN %(start)s AND %(end)s
              AND sii.item_code != 'Item Extra'
        """
        cogs_result = _safe_sql(cogs_query, {"start": start_date, "end": end_date}, as_dict=True)
        costo_productos = flt(cogs_result[0].cogs) if cogs_result else 0

        # Ajustar costo por devoluciones (items que volvieron al inventario)
        cogs_returns = _safe_sql("""
            SELECT IFNULL(SUM(ABS(sii.qty) * IFNULL(ip.price_list_rate, 0)), 0) as cogs
            FROM `tabSales Invoice Item` sii
            JOIN `tabSales Invoice` si ON si.name = sii.parent
            LEFT JOIN `tabItem Price` ip ON (ip.item_code = sii.item_code AND ip.price_list = 'Compra estandar')
            WHERE si.docstatus = 1
              AND IFNULL(si.is_return,0) = 1
              AND si.posting_date BETWEEN %(start)s AND %(end)s
              AND sii.item_code != 'Item Extra'
        """, {"start": start_date, "end": end_date}, as_dict=True)
        costo_productos -= flt(cogs_returns[0].cogs) if cogs_returns else 0

        # Embalaje: cajas asociadas a la Sales Order de cada factura del periodo.
        # Se deduplica por Sales Order para no contar la misma caja mas de una vez
        # aunque la Sales Order tenga varios Sales Invoice Items.
        embalaje_query = """
            SELECT IFNULL(SUM(cpa.cantidad * IFNULL(cp.precio, 0)), 0) as embalaje
            FROM `tabCaja Pedido Asociado` cpa
            LEFT JOIN `tabCaja Pedido` cp ON cp.name = cpa.caja
            WHERE cpa.parenttype = 'Sales Order'
              AND cpa.parent IN (
                  SELECT DISTINCT sii.sales_order
                  FROM `tabSales Invoice Item` sii
                  JOIN `tabSales Invoice` si ON si.name = sii.parent
                  WHERE si.docstatus = 1
                    AND IFNULL(si.is_return, 0) = 0
                    AND si.posting_date BETWEEN %(start)s AND %(end)s
                    AND sii.sales_order IS NOT NULL
                    AND sii.sales_order != ''
              )
        """
        embalaje_result = _safe_sql(embalaje_query, {"start": start_date, "end": end_date}, as_dict=True)
        costo_embalaje_con_igv = flt(embalaje_result[0].embalaje) if embalaje_result else 0

        # Dividir por 1.18 (los precios vienen con IGV). El Excel de referencia lleva el P&L en base imponible.
        costo_productos_con_igv = costo_productos
        costo_productos = _sin_igv(costo_productos_con_igv)
        costo_embalaje = _sin_igv(costo_embalaje_con_igv)
        costo_ventas = costo_productos + costo_embalaje
        costo_ventas_con_igv = costo_productos_con_igv + costo_embalaje_con_igv
        igv_sobre_costo = costo_ventas_con_igv - costo_ventas

        utilidad_bruta = ingresos_netos - costo_ventas

        # ============================================================
        # 3. GASTOS DE OPERACION (desde Finanzas Corporativas)
        # ============================================================
        gastos_query = """
            SELECT fc.categoria, fc.monto, fc.descripcion
            FROM `tabFinanzas Corporativas` fc
            WHERE fc.fecha BETWEEN %(start)s AND %(end)s
              AND (fc.caja_chica IS NULL OR fc.caja_chica = '')
        """
        gastos_rows = _safe_sql(gastos_query, {"start": start_date, "end": end_date}, as_dict=True)

        # Agrupar por label (excluyendo movimientos que no son gastos operacionales)
        gastos_grupos = {}
        for row in gastos_rows:
            if _es_gasto_excluido(row.categoria, row.descripcion):
                continue
            label = _categorizar_gasto(row.categoria)
            if label not in gastos_grupos:
                gastos_grupos[label] = {"monto": 0, "count": 0, "items": []}
            gastos_grupos[label]["monto"] += flt(row.monto)
            gastos_grupos[label]["count"] += 1
            gastos_grupos[label]["items"].append({
                "categoria": row.categoria,
                "descripcion": row.descripcion,
                "monto": flt(row.monto)
            })

        # Ordenar gastos en el orden del Estado de Resultados
        orden_grupos = [g["label"] for g in CATEGORIAS_GASTO]
        gastos_list = []
        for label in orden_grupos:
            if label in gastos_grupos:
                gastos_list.append({
                    "label": label,
                    "monto": gastos_grupos[label]["monto"],
                    "count": gastos_grupos[label]["count"],
                    "items": gastos_grupos[label]["items"],
                    "pct": (gastos_grupos[label]["monto"] / ingresos_netos * 100) if ingresos_netos else 0
                })

        gastos_operacion = sum(g["monto"] for g in gastos_list)

        # Comisiones de vendedoras (desde Sales Invoice si existe)
        comisiones_query = """
            SELECT IFNULL(SUM(si.custom_comision),0) as total
            FROM `tabSales Invoice` si
            WHERE si.docstatus = 1
              AND IFNULL(si.is_return,0) = 0
              AND si.posting_date BETWEEN %(start)s AND %(end)s
        """
        com_result = _safe_sql(comisiones_query, {"start": start_date, "end": end_date}, as_dict=True)
        comisiones = flt(com_result[0].total) if com_result else 0
        if comisiones > 0:
            # Agregar como grupo separado si no existe
            grupo_com = next((g for g in gastos_list if g["label"] == "Ventas"), None)
            if grupo_com:
                grupo_com["monto"] += comisiones
                grupo_com["pct"] = (grupo_com["monto"] / ingresos_netos * 100) if ingresos_netos else 0
            else:
                gastos_list.append({
                    "label": "Ventas (Comisiones)",
                    "monto": comisiones,
                    "count": 1,
                    "items": [{"categoria": "Comisiones vendedoras", "descripcion": "", "monto": comisiones}],
                    "pct": (comisiones / ingresos_netos * 100) if ingresos_netos else 0
                })
            gastos_operacion += comisiones

        utilidad_operacion = utilidad_bruta - gastos_operacion

        # ============================================================
        # 4. GASTOS EXTRAORDINARIOS (caja chica)
        # ============================================================
        extra_query = """
            SELECT IFNULL(SUM(fc.monto),0) as total
            FROM `tabFinanzas Corporativas` fc
            WHERE fc.fecha BETWEEN %(start)s AND %(end)s
              AND fc.caja_chica IS NOT NULL AND fc.caja_chica != ''
        """
        extra_result = _safe_sql(extra_query, {"start": start_date, "end": end_date}, as_dict=True)
        gastos_extraordinarios = flt(extra_result[0].total) if extra_result else 0

        utilidad_antes_impuestos = utilidad_operacion - gastos_extraordinarios

        # ============================================================
        # 5. IMPUESTO A LA RENTA (1.5% de ingresos netos)
        # ============================================================
        impuesto_renta = ingresos_netos * IMPUESTO_RENTA_PCT

        utilidad_neta = utilidad_antes_impuestos - impuesto_renta

        # ============================================================
        # 6. COMPARATIVA CON PERIODO ANTERIOR
        # ============================================================
        prev_v = _safe_sql(ventas_query, {"start": prev_start, "end": prev_end}, as_dict=True)[0]
        prev_ventas = _sin_igv(flt(prev_v.total_bruto))
        prev_descuentos = _sin_igv(flt(prev_v.descuentos))

        prev_dev_r = _safe_sql("""
            SELECT IFNULL(SUM(ABS(grand_total)),0) as total
            FROM `tabSales Invoice`
            WHERE docstatus = 1 AND IFNULL(is_return,0) = 1
              AND posting_date BETWEEN %(start)s AND %(end)s
        """, {"start": prev_start, "end": prev_end}, as_dict=True)[0]
        prev_dev_cancel = _safe_sql("""
            SELECT IFNULL(SUM(grand_total),0) as total
            FROM `tabSales Invoice`
            WHERE docstatus = 2
              AND DATE(modified) BETWEEN %(start)s AND %(end)s
              AND DATE(posting_date) < %(start)s
        """, {"start": prev_start, "end": prev_end}, as_dict=True)[0]
        prev_devoluciones = _sin_igv(flt(prev_dev_r.total) + flt(prev_dev_cancel.total))

        prev_ingresos_netos = prev_ventas - prev_descuentos - prev_devoluciones

        trend_ingresos = ((ingresos_netos - prev_ingresos_netos) / prev_ingresos_netos * 100) if prev_ingresos_netos else 0

        # Helper pct sobre ingresos netos
        def pct(val):
            return (val / ingresos_netos * 100) if ingresos_netos else 0

        return {
            "status": "success",
            "period": {
                "start": str(start_date),
                "end": str(end_date),
                "days": days_in_period,
                "prev_start": str(prev_start),
                "prev_end": str(prev_end),
            },
            "resumen": {
                "ventas_brutas": ventas_brutas,
                "ventas_brutas_con_igv": ventas_brutas_con_igv,
                "descuentos": descuentos,
                "descuentos_con_igv": descuentos_con_igv,
                "devoluciones": devoluciones,
                "devoluciones_con_igv": devoluciones_con_igv,
                "dev_is_return": dev_is_return,
                "dev_is_return_con_igv": dev_is_return_con_igv,
                "dev_cancelaciones": dev_cancelaciones,
                "dev_cancelaciones_con_igv": dev_cancelaciones_con_igv,
                "igv_sobre_ventas": igv_sobre_ventas,
                "ingresos_netos": ingresos_netos,
                "ingresos_netos_con_igv": ingresos_netos_con_igv,
                "costo_ventas": costo_ventas,
                "costo_ventas_con_igv": costo_ventas_con_igv,
                "igv_sobre_costo": igv_sobre_costo,
                "costo_productos": costo_productos,
                "costo_productos_con_igv": costo_productos_con_igv,
                "costo_embalaje": costo_embalaje,
                "costo_embalaje_con_igv": costo_embalaje_con_igv,
                "utilidad_bruta": utilidad_bruta,
                "gastos_operacion": gastos_operacion,
                "utilidad_operacion": utilidad_operacion,
                "gastos_extraordinarios": gastos_extraordinarios,
                "utilidad_antes_impuestos": utilidad_antes_impuestos,
                "impuesto_renta": impuesto_renta,
                "utilidad_neta": utilidad_neta,
                "num_facturas": v.num_facturas,
            },
            "porcentajes": {
                "descuentos": pct(descuentos),
                "devoluciones": pct(devoluciones),
                "costo_ventas": pct(costo_ventas),
                "utilidad_bruta": pct(utilidad_bruta),
                "gastos_operacion": pct(gastos_operacion),
                "utilidad_operacion": pct(utilidad_operacion),
                "gastos_extraordinarios": pct(gastos_extraordinarios),
                "impuesto_renta": pct(impuesto_renta),
                "utilidad_neta": pct(utilidad_neta),
            },
            "gastos_detalle": gastos_list,
            "comparativa": {
                "prev_ingresos_netos": prev_ingresos_netos,
                "trend_ingresos_pct": trend_ingresos,
            }
        }

    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "ESTADO-RESULTADOS-ERROR")
        return {"status": "error", "message": str(e)}


@frappe.whitelist()
def get_kpi_detail(kpi_type, start_date, end_date):
    """Retorna el detalle completo (registros) que compone cada KPI."""
    _require_view()

    try:
        start_date = getdate(start_date)
        end_date = getdate(end_date)

        if kpi_type == "ingresos_netos":
            return _detail_ingresos_netos(start_date, end_date)
        elif kpi_type == "utilidad_bruta":
            return _detail_utilidad_bruta(start_date, end_date)
        elif kpi_type == "utilidad_operacion":
            return _detail_utilidad_operacion(start_date, end_date)
        elif kpi_type == "utilidad_neta":
            return _detail_utilidad_neta(start_date, end_date)
        else:
            return {"status": "error", "message": f"KPI desconocido: {kpi_type}"}
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "ESTADO-RESULTADOS-DETAIL-ERROR")
        return {"status": "error", "message": str(e)}


def _detail_ingresos_netos(start_date, end_date):
    """Detalle de Ingresos Netos: todas las facturas del periodo."""
    facturas = _safe_sql("""
        SELECT si.name, si.posting_date, si.customer_name, si.total, si.discount_amount,
               si.grand_total, IFNULL(si.is_return,0) as is_return, si.docstatus
        FROM `tabSales Invoice` si
        WHERE si.docstatus = 1
          AND si.posting_date BETWEEN %(start)s AND %(end)s
        ORDER BY si.posting_date DESC, si.name DESC
    """, {"start": start_date, "end": end_date}, as_dict=True)

    # Cancelaciones del mes que SI afectan ingresos netos:
    # facturas con posting_date anterior al periodo pero canceladas dentro del periodo.
    canceladas = _safe_sql("""
        SELECT name, posting_date, customer_name, grand_total, DATE(modified) as cancel_date
        FROM `tabSales Invoice`
        WHERE docstatus = 2
          AND DATE(modified) BETWEEN %(start)s AND %(end)s
          AND DATE(posting_date) < %(start)s
        ORDER BY modified DESC
    """, {"start": start_date, "end": end_date}, as_dict=True)

    total_ventas_con_igv = sum(flt(f.total) for f in facturas if not f.is_return)
    total_descuentos_con_igv = sum(flt(f.discount_amount) for f in facturas if not f.is_return)
    total_dev_return_con_igv = sum(abs(flt(f.grand_total)) for f in facturas if f.is_return)
    total_dev_cancel_con_igv = sum(flt(c.grand_total) for c in canceladas)
    total_devoluciones_con_igv = total_dev_return_con_igv + total_dev_cancel_con_igv

    total_ventas = _sin_igv(total_ventas_con_igv)
    total_descuentos = _sin_igv(total_descuentos_con_igv)
    total_dev_return = _sin_igv(total_dev_return_con_igv)
    total_dev_cancel = _sin_igv(total_dev_cancel_con_igv)
    total_devoluciones = total_dev_return + total_dev_cancel
    ingresos_netos = total_ventas - total_descuentos - total_devoluciones
    ingresos_netos_con_igv = total_ventas_con_igv - total_descuentos_con_igv - total_devoluciones_con_igv

    return {
        "status": "success",
        "kpi": "ingresos_netos",
        "title": "Ingresos Netos",
        "formula": "(Ventas Brutas − Descuentos − Devoluciones) / 1.18",
        "totales": {
            "ventas_brutas": total_ventas,
            "ventas_brutas_con_igv": total_ventas_con_igv,
            "descuentos": total_descuentos,
            "descuentos_con_igv": total_descuentos_con_igv,
            "devoluciones": total_devoluciones,
            "devoluciones_con_igv": total_devoluciones_con_igv,
            "dev_is_return": total_dev_return,
            "dev_is_return_con_igv": total_dev_return_con_igv,
            "dev_cancelaciones": total_dev_cancel,
            "dev_cancelaciones_con_igv": total_dev_cancel_con_igv,
            "ingresos_netos": ingresos_netos,
            "ingresos_netos_con_igv": ingresos_netos_con_igv,
            "num_facturas": len([f for f in facturas if not f.is_return]),
            "num_returns": len([f for f in facturas if f.is_return]),
            "num_canceladas": len(canceladas),
        },
        "facturas": [dict(f, total=flt(f.total), discount_amount=flt(f.discount_amount), grand_total=flt(f.grand_total)) for f in facturas],
        "canceladas": [dict(c, grand_total=flt(c.grand_total)) for c in canceladas],
    }


def _detail_utilidad_bruta(start_date, end_date):
    """Detalle de Utilidad Bruta: items vendidos con precio de compra y margen."""
    items = _safe_sql("""
        SELECT sii.item_code, sii.item_name,
               SUM(sii.qty) as qty_total,
               SUM(sii.amount) as revenue,
               IFNULL(ip.price_list_rate, 0) as unit_cost,
               SUM(sii.qty * IFNULL(ip.price_list_rate, 0)) as cogs_total,
               COUNT(DISTINCT si.name) as num_facturas
        FROM `tabSales Invoice Item` sii
        JOIN `tabSales Invoice` si ON si.name = sii.parent
        LEFT JOIN `tabItem Price` ip ON (ip.item_code = sii.item_code AND ip.price_list = 'Compra estandar')
        WHERE si.docstatus = 1
          AND IFNULL(si.is_return,0) = 0
          AND si.posting_date BETWEEN %(start)s AND %(end)s
          AND sii.item_code != 'Item Extra'
        GROUP BY sii.item_code
        ORDER BY revenue DESC
        LIMIT 100
    """, {"start": start_date, "end": end_date}, as_dict=True)

    total_revenue = 0
    total_cogs = 0
    items_detail = []
    for i in items:
        rev = flt(i.revenue)
        cogs = flt(i.cogs_total)
        margin = rev - cogs
        margin_pct = (margin / rev * 100) if rev else 0
        total_revenue += rev
        total_cogs += cogs
        items_detail.append({
            "item_code": i.item_code,
            "item_name": i.item_name,
            "qty_total": flt(i.qty_total),
            "revenue": rev,
            "unit_cost": flt(i.unit_cost),
            "cogs_total": cogs,
            "margin": margin,
            "margin_pct": margin_pct,
            "num_facturas": i.num_facturas,
        })

    # Embalaje (cajas asociadas a las Sales Orders de las facturas del periodo)
    embalaje_result = _safe_sql("""
        SELECT IFNULL(SUM(cpa.cantidad * IFNULL(cp.precio, 0)), 0) as embalaje
        FROM `tabCaja Pedido Asociado` cpa
        LEFT JOIN `tabCaja Pedido` cp ON cp.name = cpa.caja
        WHERE cpa.parenttype = 'Sales Order'
          AND cpa.parent IN (
              SELECT DISTINCT sii.sales_order
              FROM `tabSales Invoice Item` sii
              JOIN `tabSales Invoice` si ON si.name = sii.parent
              WHERE si.docstatus = 1
                AND IFNULL(si.is_return, 0) = 0
                AND si.posting_date BETWEEN %(start)s AND %(end)s
                AND sii.sales_order IS NOT NULL AND sii.sales_order != ''
          )
    """, {"start": start_date, "end": end_date}, as_dict=True)
    costo_embalaje_con_igv = flt(embalaje_result[0].embalaje) if embalaje_result else 0

    # Dividir por 1.18 — el P&L trabaja sin IGV
    total_revenue_con_igv = total_revenue
    total_cogs_con_igv = total_cogs
    total_revenue = _sin_igv(total_revenue_con_igv)
    total_cogs_sin_igv = _sin_igv(total_cogs_con_igv)
    costo_embalaje = _sin_igv(costo_embalaje_con_igv)
    cogs_total_final = total_cogs_sin_igv + costo_embalaje
    cogs_total_con_igv = total_cogs_con_igv + costo_embalaje_con_igv
    utilidad_bruta = total_revenue - cogs_total_final

    return {
        "status": "success",
        "kpi": "utilidad_bruta",
        "title": "Utilidad Bruta",
        "formula": "(Ingresos Netos − Costo Productos − Embalaje), todo en base imponible (sin IGV)",
        "totales": {
            "revenue": total_revenue,
            "revenue_con_igv": total_revenue_con_igv,
            "cogs": cogs_total_final,
            "cogs_con_igv": cogs_total_con_igv,
            "cogs_productos": total_cogs_sin_igv,
            "cogs_productos_con_igv": total_cogs_con_igv,
            "cogs_embalaje": costo_embalaje,
            "cogs_embalaje_con_igv": costo_embalaje_con_igv,
            "utilidad_bruta": utilidad_bruta,
            "margen_pct": (utilidad_bruta / total_revenue * 100) if total_revenue else 0,
            "num_items": len(items_detail),
        },
        "items": items_detail,
    }


def _detail_utilidad_operacion(start_date, end_date):
    """Detalle de Utilidad Operacion: gastos individuales por categoria."""
    gastos = _safe_sql("""
        SELECT fc.name, fc.fecha, fc.categoria, fc.descripcion, fc.monto, fc.proveedor
        FROM `tabFinanzas Corporativas` fc
        WHERE fc.fecha BETWEEN %(start)s AND %(end)s
          AND (fc.caja_chica IS NULL OR fc.caja_chica = '')
        ORDER BY fc.fecha DESC
    """, {"start": start_date, "end": end_date}, as_dict=True)

    grupos = {}
    total_gastos = 0
    for g in gastos:
        if _es_gasto_excluido(g.categoria, g.descripcion):
            continue
        monto = flt(g.monto)
        total_gastos += monto
        label = _categorizar_gasto(g.categoria)
        if label not in grupos:
            grupos[label] = {"label": label, "monto": 0, "items": []}
        grupos[label]["monto"] += monto
        grupos[label]["items"].append({
            "name": g.name,
            "fecha": str(g.fecha),
            "categoria": g.categoria,
            "descripcion": g.descripcion or "",
            "proveedor": g.proveedor or "",
            "monto": monto,
        })

    # Ordenar grupos
    orden_grupos = [x["label"] for x in CATEGORIAS_GASTO]
    grupos_list = [grupos[l] for l in orden_grupos if l in grupos]

    return {
        "status": "success",
        "kpi": "utilidad_operacion",
        "title": "Utilidad de Operacion",
        "formula": "Utilidad Bruta − Gastos de Operacion",
        "totales": {
            "total_gastos": total_gastos,
            "num_movimientos": len(gastos),
            "num_grupos": len(grupos_list),
        },
        "grupos": grupos_list,
    }


@frappe.whitelist()
def get_concept_detail(concept, start_date, end_date):
    """Detalle de cualquier concepto del P&L (cada fila de la tabla)."""
    _require_view()

    try:
        start_date = getdate(start_date)
        end_date = getdate(end_date)

        handlers = {
            "ventas_brutas": _c_ventas_brutas,
            "descuentos": _c_descuentos,
            "devoluciones": _c_devoluciones,
            "ingresos_netos": _c_ingresos_netos,
            "costo_ventas": _c_costo_ventas,
            "utilidad_bruta": _c_utilidad_bruta,
            "gastos_operacion": _c_gastos_operacion,
            "utilidad_operacion": _c_utilidad_operacion,
            "gastos_extraordinarios": _c_gastos_extraordinarios,
            "utilidad_antes_impuestos": _c_utilidad_antes_impuestos,
            "impuesto_renta": _c_impuesto_renta,
            "utilidad_neta": _c_utilidad_neta,
        }
        handler = handlers.get(concept)
        if not handler:
            return {"status": "error", "message": f"Concepto desconocido: {concept}"}
        return handler(start_date, end_date)
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "ESTADO-RESULTADOS-CONCEPT-ERROR")
        return {"status": "error", "message": str(e)}


@frappe.whitelist()
def get_gasto_grupo_detail(grupo_label, start_date, end_date):
    """Detalle completo de un grupo especifico de gastos (ej: Sueldos y Salarios)."""
    _require_view()

    try:
        start_date = getdate(start_date)
        end_date = getdate(end_date)

        gastos = _safe_sql("""
            SELECT fc.name, fc.fecha, fc.categoria, fc.descripcion, fc.monto, fc.proveedor,
                   IFNULL(cg.tipo_gasto,'') as tipo_gasto
            FROM `tabFinanzas Corporativas` fc
            LEFT JOIN `tabCategoria Gasto` cg ON cg.name = fc.categoria
            WHERE fc.fecha BETWEEN %(start)s AND %(end)s
              AND (fc.caja_chica IS NULL OR fc.caja_chica = '')
            ORDER BY fc.fecha DESC
        """, {"start": start_date, "end": end_date}, as_dict=True)

        filtered = []
        total = 0
        for g in gastos:
            if _es_gasto_excluido(g.categoria, g.descripcion):
                continue
            label = _categorizar_gasto(g.categoria)
            if label == grupo_label:
                monto = flt(g.monto)
                total += monto
                filtered.append({
                    "name": g.name,
                    "fecha": str(g.fecha),
                    "categoria": g.categoria,
                    "descripcion": g.descripcion or "",
                    "proveedor": g.proveedor or "",
                    "tipo_gasto": g.tipo_gasto,
                    "monto": monto,
                })

        # Agrupado por categoria exacta
        por_categoria = {}
        for item in filtered:
            cat = item["categoria"]
            if cat not in por_categoria:
                por_categoria[cat] = {"categoria": cat, "monto": 0, "count": 0}
            por_categoria[cat]["monto"] += item["monto"]
            por_categoria[cat]["count"] += 1

        categorias_list = sorted(por_categoria.values(), key=lambda x: x["monto"], reverse=True)

        return {
            "status": "success",
            "grupo_label": grupo_label,
            "total": total,
            "num_movimientos": len(filtered),
            "categorias": categorias_list,
            "items": filtered,
        }
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "ESTADO-RESULTADOS-GRUPO-ERROR")
        return {"status": "error", "message": str(e)}


# ============================================================
# CONCEPT HANDLERS
# ============================================================

def _c_ventas_brutas(start, end):
    facturas = _safe_sql("""
        SELECT si.name, si.posting_date, si.customer_name, si.total, si.grand_total
        FROM `tabSales Invoice` si
        WHERE si.docstatus = 1 AND IFNULL(si.is_return,0) = 0
          AND si.posting_date BETWEEN %(start)s AND %(end)s
        ORDER BY si.total DESC
    """, {"start": start, "end": end}, as_dict=True)
    total_con_igv = sum(flt(f.total) for f in facturas)
    total_sin_igv = _sin_igv(total_con_igv)
    igv = total_con_igv - total_sin_igv
    return {
        "status": "success", "concept": "ventas_brutas", "title": "Ventas Brutas",
        "formula": "SUM(Sales Invoice.total) / 1.18",
        "explain": "Suma de la columna <code>total</code> de todas las facturas <strong>activas</strong> (docstatus=1) del periodo, excluyendo notas de credito.<br>Los montos en la BD vienen <strong>con IGV (18%)</strong>. El P&L trabaja en <strong>base imponible (sin IGV)</strong> igual que el Excel de referencia, por eso se divide entre 1.18.",
        "totales": {
            "total": total_sin_igv,
            "total_con_igv": total_con_igv,
            "total_sin_igv": total_sin_igv,
            "igv": igv,
            "num_facturas": len(facturas),
        },
        "facturas": [dict(f, total=flt(f.total), grand_total=flt(f.grand_total)) for f in facturas]
    }


def _c_descuentos(start, end):
    facturas = _safe_sql("""
        SELECT si.name, si.posting_date, si.customer_name, si.total, si.discount_amount, si.grand_total
        FROM `tabSales Invoice` si
        WHERE si.docstatus = 1 AND IFNULL(si.is_return,0) = 0
          AND si.posting_date BETWEEN %(start)s AND %(end)s
          AND si.discount_amount > 0
        ORDER BY si.discount_amount DESC
    """, {"start": start, "end": end}, as_dict=True)
    total_con_igv = sum(flt(f.discount_amount) for f in facturas)
    total_sin_igv = _sin_igv(total_con_igv)
    igv = total_con_igv - total_sin_igv
    return {
        "status": "success", "concept": "descuentos", "title": "Descuentos",
        "formula": "SUM(Sales Invoice.discount_amount) / 1.18",
        "explain": "Suma de los descuentos aplicados a nivel de factura (campo <code>discount_amount</code>). Solo se muestran facturas con descuento > 0. Se divide entre 1.18 para llevarlos a base imponible (sin IGV).",
        "totales": {
            "total": total_sin_igv,
            "total_con_igv": total_con_igv,
            "total_sin_igv": total_sin_igv,
            "igv": igv,
            "num_facturas": len(facturas),
        },
        "facturas": [dict(f, total=flt(f.total), discount_amount=flt(f.discount_amount), grand_total=flt(f.grand_total)) for f in facturas]
    }


def _c_devoluciones(start, end):
    # Notas de credito
    returns = _safe_sql("""
        SELECT si.name, si.posting_date, si.customer_name, si.grand_total, si.return_against
        FROM `tabSales Invoice` si
        WHERE si.docstatus = 1 AND IFNULL(si.is_return,0) = 1
          AND si.posting_date BETWEEN %(start)s AND %(end)s
        ORDER BY ABS(si.grand_total) DESC
    """, {"start": start, "end": end}, as_dict=True)

    # Facturas canceladas (docstatus=2) que afectan ingresos: posting_date anterior al periodo
    # pero canceladas dentro del periodo. Las creadas y canceladas en el mismo periodo ya estan
    # excluidas de ventas brutas por docstatus=1, asi que restarlas seria doble descuento.
    canceladas = _safe_sql("""
        SELECT name, posting_date, customer_name, grand_total, DATE(modified) as cancel_date
        FROM `tabSales Invoice`
        WHERE docstatus = 2
          AND DATE(modified) BETWEEN %(start)s AND %(end)s
          AND DATE(posting_date) < %(start)s
        ORDER BY grand_total DESC
    """, {"start": start, "end": end}, as_dict=True)

    total_nc_con_igv = sum(abs(flt(r.grand_total)) for r in returns)
    total_canc_con_igv = sum(flt(c.grand_total) for c in canceladas)
    total_con_igv = total_nc_con_igv + total_canc_con_igv
    total_sin_igv = _sin_igv(total_con_igv)
    igv = total_con_igv - total_sin_igv

    return {
        "status": "success", "concept": "devoluciones", "title": "Devoluciones",
        "formula": "[SUM(|grand_total|) de Notas de Credito + SUM(grand_total) de Canceladas] / 1.18",
        "explain": "Las devoluciones incluyen:<br>1. <strong>Notas de Credito</strong> (Sales Invoice con <code>is_return=1</code>) — cuando se hace devolucion parcial y SUNAT acepta.<br>2. <strong>Facturas canceladas</strong> (docstatus=2) — cuando la devolucion fue total y se anulo la boleta completa.<br>Se dividen entre 1.18 para llevarlas a base imponible.",
        "totales": {
            "total": total_sin_igv,
            "total_con_igv": total_con_igv,
            "total_sin_igv": total_sin_igv,
            "igv": igv,
            "total_nc": _sin_igv(total_nc_con_igv),
            "total_nc_con_igv": total_nc_con_igv,
            "total_canceladas": _sin_igv(total_canc_con_igv),
            "total_canceladas_con_igv": total_canc_con_igv,
            "num_nc": len(returns),
            "num_canceladas": len(canceladas),
        },
        "returns": [dict(r, grand_total=flt(r.grand_total)) for r in returns],
        "canceladas": [dict(c, grand_total=flt(c.grand_total), cancel_date=str(c.cancel_date)) for c in canceladas]
    }


def _c_ingresos_netos(start, end):
    return _detail_ingresos_netos(start, end)


def _c_costo_ventas(start, end):
    items = _safe_sql("""
        SELECT sii.item_code, sii.item_name,
               SUM(sii.qty) as qty_total,
               SUM(sii.amount) as revenue,
               IFNULL(ip.price_list_rate, 0) as unit_cost,
               SUM(sii.qty * IFNULL(ip.price_list_rate, 0)) as cogs_total,
               COUNT(DISTINCT si.name) as num_facturas
        FROM `tabSales Invoice Item` sii
        JOIN `tabSales Invoice` si ON si.name = sii.parent
        LEFT JOIN `tabItem Price` ip ON (ip.item_code = sii.item_code AND ip.price_list = 'Compra estandar')
        WHERE si.docstatus = 1 AND IFNULL(si.is_return,0) = 0
          AND si.posting_date BETWEEN %(start)s AND %(end)s
          AND sii.item_code != 'Item Extra'
        GROUP BY sii.item_code
        ORDER BY cogs_total DESC
    """, {"start": start, "end": end}, as_dict=True)
    total_productos = sum(flt(i.cogs_total) for i in items)
    items_list = [{
        "item_code": i.item_code, "item_name": i.item_name,
        "qty_total": flt(i.qty_total), "revenue": flt(i.revenue),
        "unit_cost": flt(i.unit_cost), "cogs_total": flt(i.cogs_total),
        "num_facturas": i.num_facturas,
    } for i in items]

    # Embalaje: cajas asociadas a Sales Orders del periodo, desglosadas por tipo de caja
    cajas = _safe_sql("""
        SELECT cp.name as caja, cp.precio as precio_unitario,
               SUM(cpa.cantidad) as cantidad_total,
               SUM(cpa.cantidad * IFNULL(cp.precio, 0)) as subtotal,
               COUNT(DISTINCT cpa.parent) as num_ordenes
        FROM `tabCaja Pedido Asociado` cpa
        LEFT JOIN `tabCaja Pedido` cp ON cp.name = cpa.caja
        WHERE cpa.parenttype = 'Sales Order'
          AND cpa.parent IN (
              SELECT DISTINCT sii.sales_order
              FROM `tabSales Invoice Item` sii
              JOIN `tabSales Invoice` si ON si.name = sii.parent
              WHERE si.docstatus = 1 AND IFNULL(si.is_return, 0) = 0
                AND si.posting_date BETWEEN %(start)s AND %(end)s
                AND sii.sales_order IS NOT NULL AND sii.sales_order != ''
          )
        GROUP BY cp.name
        ORDER BY subtotal DESC
    """, {"start": start, "end": end}, as_dict=True)
    total_embalaje = sum(flt(c.subtotal) for c in cajas)
    cajas_list = [{
        "caja": c.caja, "precio_unitario": flt(c.precio_unitario),
        "cantidad_total": flt(c.cantidad_total), "subtotal": flt(c.subtotal),
        "num_ordenes": c.num_ordenes,
    } for c in cajas]

    total_productos_con_igv = total_productos
    total_embalaje_con_igv = total_embalaje
    total_con_igv = total_productos_con_igv + total_embalaje_con_igv
    total_sin_igv = _sin_igv(total_con_igv)
    igv = total_con_igv - total_sin_igv

    return {
        "status": "success", "concept": "costo_ventas", "title": "Costo de Ventas (COGS)",
        "formula": "[SUM(qty × precio_compra) + SUM(cantidad_caja × precio_caja)] / 1.18",
        "explain": "El COGS se compone de dos partes:<br>1. <strong>Costo de productos</strong>: cantidad vendida × precio de la lista <code>Compra estandar</code>.<br>2. <strong>Embalaje</strong>: suma de <code>Caja Pedido Asociado</code> × precio unitario de <code>Caja Pedido</code>.<br>Los precios vienen <strong>con IGV</strong> y se dividen entre 1.18 para llevarlos a base imponible (igual que el Excel de referencia).",
        "totales": {
            "total": total_sin_igv,
            "total_con_igv": total_con_igv,
            "total_sin_igv": total_sin_igv,
            "igv": igv,
            "total_productos": _sin_igv(total_productos_con_igv),
            "total_productos_con_igv": total_productos_con_igv,
            "total_embalaje": _sin_igv(total_embalaje_con_igv),
            "total_embalaje_con_igv": total_embalaje_con_igv,
            "num_items": len(items_list),
            "num_cajas": len(cajas_list),
        },
        "items": items_list,
        "cajas": cajas_list,
    }


def _c_utilidad_bruta(start, end):
    return _detail_utilidad_bruta(start, end)


def _c_gastos_operacion(start, end):
    return _detail_utilidad_operacion(start, end)


def _c_utilidad_operacion(start, end):
    resumen = get_estado_resultados(str(start), str(end))
    if resumen.get("status") != "success":
        return resumen
    r = resumen["resumen"]
    return {
        "status": "success", "concept": "utilidad_operacion", "title": "Utilidad de Operacion",
        "formula": "Utilidad Bruta − Gastos de Operacion",
        "explain": "Es la ganancia antes de gastos extraordinarios e impuestos. Refleja la rentabilidad real del negocio operativo.",
        "breakdown": {
            "utilidad_bruta": r["utilidad_bruta"],
            "gastos_operacion": r["gastos_operacion"],
            "utilidad_operacion": r["utilidad_operacion"],
        },
        "grupos": resumen["gastos_detalle"]
    }


def _c_gastos_extraordinarios(start, end):
    items = _safe_sql("""
        SELECT fc.name, fc.fecha, fc.categoria, fc.descripcion, fc.monto, fc.proveedor, fc.caja_chica
        FROM `tabFinanzas Corporativas` fc
        WHERE fc.fecha BETWEEN %(start)s AND %(end)s
          AND fc.caja_chica IS NOT NULL AND fc.caja_chica != ''
        ORDER BY fc.monto DESC
    """, {"start": start, "end": end}, as_dict=True)
    total = sum(flt(i.monto) for i in items)
    return {
        "status": "success", "concept": "gastos_extraordinarios", "title": "Gastos Extraordinarios",
        "formula": "SUM(monto) FROM Finanzas Corporativas WHERE caja_chica IS NOT NULL",
        "explain": "Gastos no recurrentes o de caja chica. Se identifican porque tienen el campo <code>caja_chica</code> con valor (indicando que vinieron de una caja chica especifica).",
        "totales": {"total": total, "num_items": len(items)},
        "items": [dict(i, monto=flt(i.monto), fecha=str(i.fecha)) for i in items]
    }


def _c_utilidad_antes_impuestos(start, end):
    resumen = get_estado_resultados(str(start), str(end))
    if resumen.get("status") != "success":
        return resumen
    r = resumen["resumen"]
    return {
        "status": "success", "concept": "utilidad_antes_impuestos", "title": "Utilidad antes de Impuestos",
        "formula": "Utilidad de Operacion − Gastos Extraordinarios",
        "explain": "Es la utilidad operativa ajustada por gastos no recurrentes, antes de aplicar el impuesto a la renta.",
        "breakdown": {
            "utilidad_operacion": r["utilidad_operacion"],
            "gastos_extraordinarios": r["gastos_extraordinarios"],
            "utilidad_antes_impuestos": r["utilidad_antes_impuestos"],
        }
    }


def _c_impuesto_renta(start, end):
    resumen = get_estado_resultados(str(start), str(end))
    if resumen.get("status") != "success":
        return resumen
    r = resumen["resumen"]
    return {
        "status": "success", "concept": "impuesto_renta", "title": "Impuesto a la Renta",
        "formula": "Ingresos Netos × 1.5%",
        "explain": "Asume <strong>Regimen MYPE Tributario (RMT)</strong>. En este regimen, el pago a cuenta mensual del Impuesto a la Renta es el <strong>1.5% sobre los ingresos netos mensuales</strong>.",
        "breakdown": {
            "ingresos_netos": r["ingresos_netos"],
            "porcentaje": 1.5,
            "impuesto_renta": r["impuesto_renta"],
        }
    }


def _c_utilidad_neta(start, end):
    return _detail_utilidad_neta(start, end)


def _detail_utilidad_neta(start_date, end_date):
    """Detalle completo de Utilidad Neta: resumen con todos los componentes."""
    # Reusa el calculo del reporte completo
    resumen = get_estado_resultados(str(start_date), str(end_date))
    if resumen.get("status") != "success":
        return resumen

    # Gastos extraordinarios detallado
    extra_items = _safe_sql("""
        SELECT fc.name, fc.fecha, fc.categoria, fc.descripcion, fc.monto, fc.proveedor, fc.caja_chica
        FROM `tabFinanzas Corporativas` fc
        WHERE fc.fecha BETWEEN %(start)s AND %(end)s
          AND fc.caja_chica IS NOT NULL AND fc.caja_chica != ''
        ORDER BY fc.fecha DESC
    """, {"start": start_date, "end": end_date}, as_dict=True)

    return {
        "status": "success",
        "kpi": "utilidad_neta",
        "title": "Utilidad Neta",
        "formula": "Utilidad antes de Impuestos − Impuesto a la Renta (1.5%)",
        "resumen": resumen["resumen"],
        "porcentajes": resumen["porcentajes"],
        "gastos_extra_items": [dict(e, monto=flt(e.monto), fecha=str(e.fecha)) for e in extra_items],
    }

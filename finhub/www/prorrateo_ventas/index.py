import frappe
import calendar
from frappe.utils import getdate, nowdate, flt

ADMIN_ROLES = ("Finhub-Finanzas-Administrar",)
VIEW_ROLES = ("Finhub-Finanzas-Ver", "Finhub-Finanzas-Administrar")


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


def _safe_sql(query, params=None, as_dict=False, default=None):
    """Ejecuta SQL silenciando errores por tabla/columna inexistente.
    finhub es un hub nuevo: muchos DocTypes de la fuente (Lizaraso) aún
    no existen aquí. Devolvemos un default razonable en ese caso para
    que la página siga cargando en modo 'sin datos'."""
    try:
        return frappe.db.sql(query, params or (), as_dict=as_dict)
    except Exception:
        frappe.db.rollback()
        if default is not None:
            return default
        return [] if as_dict else [[0]]


def get_context(context):
    context.no_cache = 1
    context.no_header = 1
    context.no_breadcrumbs = 1
    context.no_footer = 1

    context.no_access = not _can_view()
    context.required_roles = list(VIEW_ROLES)
    context.can_edit = _is_admin()

    if context.no_access:
        context.lista_tiendas = []
        return

    try:
        context.lista_tiendas = frappe.get_all("Tienda", fields=["name"])
    except Exception:
        context.lista_tiendas = []


@frappe.whitelist()
def get_prorrateo_ventas(fecha_desde=None, fecha_hasta=None, canal="", q=""):
    """Obtiene el prorrateo desglosado por cada venta (Sales Invoice)."""
    _require_view()

    today = getdate(nowdate())
    if not fecha_desde:
        fecha_desde = f"{today.year}-{today.month:02d}-01"
    if not fecha_hasta:
        last_day = calendar.monthrange(today.year, today.month)[1]
        fecha_hasta = f"{today.year}-{today.month:02d}-{last_day}"

    start_date = str(getdate(fecha_desde))
    end_date = str(getdate(fecha_hasta))

    # ── CALCULAR PRORRATEO BASE ──
    total_fijos = flt(_safe_sql("""
        SELECT IFNULL(SUM(fc.monto), 0)
        FROM `tabFinanzas Corporativas` fc
        JOIN `tabCategoria Gasto` cg ON cg.name = fc.categoria
        WHERE cg.tipo_gasto = 'Fijo'
          AND (fc.caja_chica IS NULL OR fc.caja_chica = '')
          AND fc.fecha BETWEEN %s AND %s
    """, (start_date, end_date))[0][0])

    total_caja = flt(_safe_sql("""
        SELECT IFNULL(SUM(p.monto), 0)
        FROM `tabPago Finanzas P` p
        JOIN `tabPago finanzas P Asociado` pa ON pa.serie = p.name
        JOIN `tabCaja Chica` cc ON cc.name = pa.parent
        JOIN `tabCategoria Pago` cp ON cp.name = p.categoria_pago
        WHERE cp.incluir_en_prorrateo = 1
          AND cc.fecha BETWEEN %s AND %s
    """, (start_date, end_date))[0][0])

    # ── REGLAS DE PRORRATEO ──
    reglas_filas = []
    try:
        regla = frappe.get_all("Regla Prorracteo", fields=["name"], limit=1, order_by="modified desc")
        if regla:
            reglas_filas = frappe.get_all("Prorrateo Asociado",
                filters={"parent": regla[0].name, "parenttype": "Regla Prorracteo"},
                fields=["rango_1", "rango_2", "peso"],
                order_by="rango_1 asc"
            )
    except Exception:
        reglas_filas = []

    # ── FACTURAS DEL PERIODO ──
    # Detectar custom fields en Sales Order / Sales Invoice (pueden no existir en finhub fresh)
    so_cols = set()
    si_cols = set()
    try:
        so_cols = {c[0] for c in frappe.db.sql(
            "SELECT COLUMN_NAME FROM information_schema.columns "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tabSales Order'"
        )}
        si_cols = {c[0] for c in frappe.db.sql(
            "SELECT COLUMN_NAME FROM information_schema.columns "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tabSales Invoice'"
        )}
    except Exception:
        pass

    so_tienda = "IFNULL(so.custom_tienda, 'N/A') AS canal" if "custom_tienda" in so_cols else "'N/A' AS canal"
    so_courier = "IFNULL(so.custom_courier, 'N/A') AS courier" if "custom_courier" in so_cols else "'N/A' AS courier"
    so_envio = "IFNULL(so.custom_costo_envio_interno, 0) AS envio_interno" if "custom_costo_envio_interno" in so_cols else "0 AS envio_interno"
    si_comision_col = "si.custom_comision" if "custom_comision" in si_cols else "0 AS custom_comision"

    conditions = ["si.docstatus = 1", "si.posting_date BETWEEN %(start)s AND %(end)s"]
    params = {"start": start_date, "end": end_date}

    if q:
        conditions.append("(si.name LIKE %(q)s OR so.name LIKE %(q)s)")
        params["q"] = f"%{q}%"
    if canal and "custom_tienda" in so_cols:
        conditions.append("IFNULL(so.custom_tienda, '') = %(canal)s")
        params["canal"] = canal

    where_clause = " AND ".join(conditions)

    invoices = _safe_sql(f"""
        SELECT
            si.name AS factura,
            si.posting_date AS fecha,
            si.customer_name,
            si.base_grand_total,
            {si_comision_col},
            IFNULL(so.name, '') AS orden_venta,
            {so_tienda},
            {so_courier},
            {so_envio}
        FROM `tabSales Invoice` si
        LEFT JOIN `tabSales Invoice Item` sii ON sii.parent = si.name
        LEFT JOIN `tabSales Order` so ON so.name = sii.sales_order
        WHERE {where_clause}
        GROUP BY si.name
        ORDER BY si.posting_date DESC, si.creation DESC
    """, params, as_dict=True, default=[])

    facturas_count = len(invoices)
    prorrateo_base = (total_fijos + total_caja) / facturas_count if facturas_count > 0 else 0

    # ── CACHE: precios de compra ──
    std_prices = _safe_sql("""
        SELECT item_code, price_list_rate
        FROM `tabItem Price`
        WHERE price_list = 'Compra estandar'
    """, as_dict=True, default=[])
    prices_dict = {p["item_code"]: flt(p["price_list_rate"]) for p in std_prices}

    # Detectar custom fields de comisión en Mode of Payment
    mop_has_comision = False
    mop_has_fijo = False
    try:
        mop_cols = {c[0] for c in frappe.db.sql(
            "SELECT COLUMN_NAME FROM information_schema.columns "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tabMode of Payment'"
        )}
        mop_has_comision = "custom_comision" in mop_cols
        mop_has_fijo = "custom_comision_fijo" in mop_cols
    except Exception:
        pass

    mop_comision_expr = "mop.custom_comision" if mop_has_comision else "0"
    mop_fijo_expr = "mop.custom_comision_fijo" if mop_has_fijo else "0"

    def get_prorrateo_para_monto(monto):
        """Busca en las reglas de prorrateo el peso que corresponde al monto de la venta."""
        for regla_fila in reglas_filas:
            if flt(regla_fila.rango_1) <= monto <= flt(regla_fila.rango_2):
                return prorrateo_base * (flt(regla_fila.peso) / 100)
        return prorrateo_base

    # ── PROCESAR CADA FACTURA ──
    results = []
    sum_ingreso = 0
    sum_costo = 0
    sum_embalaje = 0
    sum_prorrateo = 0
    sum_envio = 0
    sum_comision_venta = 0
    sum_comision = 0
    sum_margen = 0
    commissions_by_mode = {}

    for inv in invoices:
        ingreso = flt(inv["base_grand_total"])
        if ingreso <= 0:
            continue

        # Costo de productos
        items = _safe_sql("""
            SELECT item_code, qty
            FROM `tabSales Invoice Item`
            WHERE parent = %s
        """, (inv["factura"],), as_dict=True, default=[])

        costo_venta = 0
        for it in items:
            unit_cost = prices_dict.get(it["item_code"], 0)
            costo_venta += unit_cost * flt(it["qty"])

        # Embalaje (cajas asociadas al Sales Order)
        embalaje = 0
        if inv["orden_venta"]:
            embalaje_rows = _safe_sql("""
                SELECT IFNULL(SUM(cpa.cantidad * IFNULL(cp.precio, 0)), 0)
                FROM `tabCaja Pedido Asociado` cpa
                LEFT JOIN `tabCaja Pedido` cp ON cp.name = cpa.caja
                WHERE cpa.parent = %s AND cpa.parenttype = 'Sales Order'
            """, (inv["orden_venta"],))
            if embalaje_rows and embalaje_rows[0]:
                embalaje = flt(embalaje_rows[0][0])

        # Prorrateo según reglas
        prorrateo_valor = get_prorrateo_para_monto(ingreso)

        # Envio interno del Sales Order
        envio = flt(inv["envio_interno"])

        # Comisiones por método de pago (Sales Invoice + Payment Entry)
        all_payments = _safe_sql(f"""
            SELECT mode_of_payment, amount, custom_comision, custom_comision_fijo FROM (
                SELECT
                    sip.mode_of_payment, sip.amount,
                    {mop_comision_expr} AS custom_comision,
                    {mop_fijo_expr} AS custom_comision_fijo
                FROM `tabSales Invoice Payment` sip
                LEFT JOIN `tabMode of Payment` mop ON mop.name = sip.mode_of_payment
                WHERE sip.parent = %s

                UNION ALL

                SELECT
                    pe.mode_of_payment, per.allocated_amount AS amount,
                    {mop_comision_expr} AS custom_comision,
                    {mop_fijo_expr} AS custom_comision_fijo
                FROM `tabPayment Entry Reference` per
                INNER JOIN `tabPayment Entry` pe ON pe.name = per.parent
                LEFT JOIN `tabMode of Payment` mop ON mop.name = pe.mode_of_payment
                WHERE per.reference_name = %s AND pe.docstatus = 1
            ) AS combined_payments
        """, (inv["factura"], inv["factura"]), as_dict=True, default=[])

        comision = 0
        for p in all_payments:
            p_mode = p["mode_of_payment"] or "Desconocido"
            p_amount = flt(p["amount"])
            p_pct = flt(p["custom_comision"])
            p_fijo = flt(p["custom_comision_fijo"])
            p_comision = (p_amount * (p_pct / 100.0)) + p_fijo
            comision += p_comision
            commissions_by_mode[p_mode] = commissions_by_mode.get(p_mode, 0.0) + p_comision

        comision_venta = flt(inv.get("custom_comision"))

        margen_neto = ingreso - costo_venta - embalaje - prorrateo_valor - envio - comision_venta - comision

        results.append({
            "factura": inv["factura"],
            "orden_venta": inv["orden_venta"],
            "fecha": str(inv["fecha"]),
            "cliente": inv["customer_name"],
            "canal": inv["canal"],
            "ingreso": ingreso,
            "costo_venta": costo_venta,
            "embalaje": embalaje,
            "prorrateado": prorrateo_valor,
            "envio": envio,
            "comision_venta": comision_venta,
            "comision": comision,
            "margen_neto": margen_neto,
            "margen_pct": (margen_neto / ingreso * 100) if ingreso > 0 else 0,
        })

        sum_ingreso += ingreso
        sum_costo += costo_venta
        sum_embalaje += embalaje
        sum_prorrateo += prorrateo_valor
        sum_envio += envio
        sum_comision_venta += comision_venta
        sum_comision += comision
        sum_margen += margen_neto

    return {
        "data": results,
        "resumen": {
            "gastos_fijos": total_fijos,
            "caja_chica": total_caja,
            "facturas_count": facturas_count,
            "prorrateo_base": prorrateo_base,
        },
        "totales": {
            "count": len(results),
            "ingreso": sum_ingreso,
            "costo_venta": sum_costo,
            "embalaje": sum_embalaje,
            "prorrateado": sum_prorrateo,
            "envio": sum_envio,
            "comision_venta": sum_comision_venta,
            "comision": sum_comision,
            "margen_neto": sum_margen,
            "margen_pct": (sum_margen / sum_ingreso * 100) if sum_ingreso > 0 else 0,
            "commissions_by_mode": commissions_by_mode,
        }
    }

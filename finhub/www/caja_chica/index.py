import frappe
from frappe import _
from frappe.utils import getdate, nowdate, add_days, flt

ADMIN_ROLES = ("Finhub-Caja-Administrar",)
VIEW_ROLES = ("Finhub-Caja-Ver", "Finhub-Caja-Administrar")

# Gastos de Distribucion roles (del modulo hermano)
GD_VIEW_ROLES = ("Finhub-Finanzas-Ver", "Finhub-Finanzas-Administrar")
GD_ADMIN_ROLES = ("Finhub-Finanzas-Administrar",)


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


def _require_admin():
    if not _is_admin():
        frappe.throw(
            "Acceso denegado. Requiere el rol: "
            + ", ".join(ADMIN_ROLES),
            frappe.PermissionError,
        )


def _has_gd_view():
    roles = set(frappe.get_roles(frappe.session.user))
    return bool(roles.intersection(GD_VIEW_ROLES))


def _has_gd_admin():
    roles = set(frappe.get_roles(frappe.session.user))
    return bool(roles.intersection(GD_ADMIN_ROLES))


def get_context(context):
    context.title = _("Caja Chica")
    context.no_access = not _can_view()
    context.required_roles = list(VIEW_ROLES)
    context.can_edit = _is_admin()

@frappe.whitelist()
def get_initial_data():
    _require_view()

    # Fetch Categories
    categories = frappe.get_all("Categoria Gasto", fields=["name", "tipo_gasto"], order_by="name asc")

    # Fetch Payment Methods
    payment_methods = frappe.get_all("Metodo Pago", fields=["name"], order_by="name asc")

    # Fetch Attachment Categories
    attachment_categories = frappe.get_all("Categoria Adjuntos Finanzas", fields=["name"], order_by="name asc")

    # Fetch Payment Categories
    payment_categories = frappe.get_all("Categoria Pago", fields=["nombre"], order_by="nombre asc")

    # Fetch Users for 'Responsable'
    users = frappe.get_all("User", fields=["name", "full_name"], filters={"enabled": 1, "user_type": "System User"}, order_by="full_name asc")

    # Fetch Daily and Monthly Stats
    stats = get_summary_stats()

    return {
        "categories": categories,
        "payment_methods": [p.name for p in payment_methods],
        "attachment_categories": [c.name for c in attachment_categories],
        "payment_categories": [c.nombre for c in payment_categories],
        "users": users,
        "stats": stats
    }

@frappe.whitelist()
def get_summary_stats(filters=None):
    _require_view()

    import json
    if isinstance(filters, str):
        filters = json.loads(filters)

    from frappe.utils import nowdate, get_first_day, get_last_day
    today = nowdate()

    # Defaults
    start = get_first_day(today)
    end = get_last_day(today)

    if filters:
        if filters.get("start_date"): start = filters.get("start_date")
        if filters.get("end_date"): end = filters.get("end_date")

    # 1. Gastado Hoy (Always today regardless of filters, or should it be within range?)
    # User said "filtro de fecha afecte la metrica".
    # Usually "Hoy" is just "Hoy". I'll keep it as today.
    total_hoy = frappe.db.sql("""
        SELECT SUM(monto)
        FROM `tabCaja Chica`
        WHERE DATE(fecha) = %s
    """, (today))[0][0] or 0

    # 2. Total en Rango (Selected period)
    total_periodo = frappe.db.sql("""
        SELECT SUM(monto)
        FROM `tabCaja Chica`
        WHERE DATE(fecha) BETWEEN %s AND %s
    """, (start, end))[0][0] or 0

    # 3. Gasto por categoría en el periodo
    category_stats = frappe.db.sql("""
        SELECT
            COALESCE(p.categoria_pago, 'Sin categoría') as categoria,
            SUM(p.monto) as total
        FROM `tabPago Finanzas P` p
        INNER JOIN `tabPago finanzas P Asociado` pa ON pa.serie = p.name
        INNER JOIN `tabCaja Chica` c ON c.name = pa.parent
        WHERE DATE(c.fecha) BETWEEN %s AND %s
        GROUP BY COALESCE(p.categoria_pago, 'Sin categoría')
        ORDER BY total DESC
    """, (start, end), as_dict=True)

    return {
        "total_hoy": float(total_hoy),
        "total_mes": float(total_periodo),
        "category_stats": [{"categoria": r.categoria, "total": float(r.total)} for r in category_stats]
    }

@frappe.whitelist()
def get_caja_list(filters=None):
    _require_view()

    import json
    if isinstance(filters, str):
        filters = json.loads(filters)

    conditions = {}
    if filters:
        if filters.get("estado"):
            conditions["estado"] = filters.get("estado")
        if filters.get("responsable"):
            conditions["responsable"] = filters.get("responsable")
        if filters.get("start_date") and filters.get("end_date"):
            conditions["fecha"] = ["between", [filters["start_date"], filters["end_date"]]]

    cajas = frappe.get_all("Caja Chica",
        filters=conditions,
        fields=["name", "fecha", "monto", "responsable", "estado", "descripcion", "saldo_restante", "creation"],
        order_by="fecha desc, creation desc",
        limit=50
    )

    # Fetch Attachments and Payments
    if cajas:
        names = [d.name for d in cajas]

        # 1. Attachments
        all_attachments = frappe.get_all("Finanzas Adjuntos Asociado",
            filters={"parent": ["in", names]},
            fields=["parent", "categoria", "archivo"]
        )
        att_map = {}
        for att in all_attachments:
            if att.parent not in att_map:
                att_map[att.parent] = []
            att_map[att.parent].append(att)

        # 2. Payments (Linked via 'Pago finanzas P Asociado')
        linked_payments = frappe.get_all("Pago finanzas P Asociado",
            filters={"parent": ["in", names]},
            fields=["parent", "serie"]
        )

        payment_ids = [lp.serie for lp in linked_payments if lp.serie]
        payments_details = {}

        if payment_ids:
            p_docs = frappe.get_all("Pago Finanzas P",
                filters={"name": ["in", payment_ids]},
                fields=["name", "fecha_hora_pago", "monto", "modo_pago", "creation"]
            )
            # Fetch Payment Attachments
            p_attachments = frappe.get_all("Adjunto Pago Asociado",
                filters={"parent": ["in", payment_ids]},
                fields=["parent", "adjunto", "categoria_pago"]
            )
            p_att_map = {}
            for pa in p_attachments:
                if pa.parent not in p_att_map: p_att_map[pa.parent] = []
                p_att_map[pa.parent].append(pa)

            for p in p_docs:
                p.adjuntos = p_att_map.get(p.name, [])
                payments_details[p.name] = p

        exp_pay_map = {}
        for lp in linked_payments:
            if lp.parent not in exp_pay_map: exp_pay_map[lp.parent] = []
            if lp.serie in payments_details:
                exp_pay_map[lp.parent].append(payments_details[lp.serie])

        for c in cajas:
            c.adjuntos = att_map.get(c.name, [])
            c.pagos = exp_pay_map.get(c.name, [])

    return cajas

@frappe.whitelist()
def get_caja_details(name):
    _require_view()
    recalculate_caja_balance(name)
    doc = frappe.get_doc("Caja Chica", name)
    return doc.as_dict()

def _get_finanza_for_caja(caja_name):
    """Busca la Finanza Corporativa enlazada a una Caja Chica."""
    return frappe.db.get_value("Finanzas Corporativas", {"caja_chica": caja_name}, "name")

def _sync_finanza_status(caja_name, estado):
    """Sincroniza el estado de la Finanza Corporativa enlazada."""
    finanza_name = _get_finanza_for_caja(caja_name)
    if finanza_name:
        try:
            finanza = frappe.get_doc("Finanzas Corporativas", finanza_name)
            new_estado = "Pagado" if estado == "Cerrada" else "Pendiente"
            finanza.estado = new_estado
            finanza.recordatorio_activo = 0 if new_estado == "Pagado" else 1
            finanza.flags.ignore_permissions = True
            finanza.save(ignore_permissions=True)
        except Exception as e:
            frappe.log_error(frappe.get_traceback(), "SYNC-FINANZA-STATUS-ERROR")

@frappe.whitelist()
def get_cajas_con_saldo():
    """Retorna cajas cerradas que tienen saldo restante > 0 para transferencia."""
    _require_view()

    return frappe.db.sql("""
        SELECT name, fecha, monto, saldo_restante
        FROM `tabCaja Chica`
        WHERE estado = 'Cerrada' AND saldo_restante > 0
        ORDER BY fecha DESC
    """, as_dict=True)

@frappe.whitelist()
def save_caja(data):
    _require_admin()

    import json
    if isinstance(data, str):
        data = json.loads(data)

    try:
        is_new = not data.get("name")

        if data.get("name"):
            doc = frappe.get_doc("Caja Chica", data.get("name"))
        else:
            doc = frappe.new_doc("Caja Chica")

        doc.fecha = data.get("fecha") or nowdate()
        doc.responsable = data.get("responsable") or frappe.session.user
        doc.monto = data.get("monto")
        doc.descripcion = data.get("descripcion")
        doc.estado = data.get("estado") or "Abierta"

        # Handle Attachments
        doc.set("adjuntos", [])
        if data.get("adjuntos"):
            for item in data.get("adjuntos"):
                doc.append("adjuntos", {
                    "categoria": item.get("categoria"),
                    "archivo": item.get("archivo")
                })

        doc.save()

        # --- TRANSFERENCIA DE SALDO: arrastrar saldo de caja anterior ---
        saldo_transferido = 0
        caja_origen = data.get("caja_origen")
        if is_new and caja_origen:
            origen = frappe.get_doc("Caja Chica", caja_origen)
            if origen.estado == "Cerrada" and flt(origen.saldo_restante) > 0:
                saldo_transferido = flt(origen.saldo_restante)
                doc.monto = flt(doc.monto) + saldo_transferido
                doc.save()
                # Poner saldo de la caja origen en 0
                origen.db_set("saldo_restante", 0)

        recalculate_caja_balance(doc.name)

        # --- INTEGRACIÓN: Crear Finanza Corporativa automáticamente ---
        if is_new:
            try:
                if not frappe.db.exists("Categoria Gasto", "Caja Chica"):
                    cat = frappe.new_doc("Categoria Gasto")
                    cat.nombre = "Caja Chica"
                    cat.tipo_gasto = "Fijo"
                    cat.flags.ignore_permissions = True
                    cat.insert(ignore_permissions=True)

                finanza = frappe.new_doc("Finanzas Corporativas")
                finanza.fecha = doc.fecha
                finanza.categoria = "Caja Chica"
                finanza.monto = doc.monto
                finanza.descripcion = doc.descripcion or f"Caja Chica {doc.name}"
                finanza.estado = "Pendiente"
                finanza.caja_chica = doc.name
                finanza.flags.ignore_permissions = True
                finanza.insert(ignore_permissions=True)
            except Exception as e:
                frappe.log_error(frappe.get_traceback(), "AUTO-CREATE-FINANZA-ERROR")
        else:
            # Sincronizar cambios a la Finanza Corporativa enlazada
            finanza_name = _get_finanza_for_caja(doc.name)
            if finanza_name:
                try:
                    finanza = frappe.get_doc("Finanzas Corporativas", finanza_name)
                    finanza.fecha = doc.fecha
                    finanza.monto = doc.monto
                    finanza.descripcion = doc.descripcion
                    finanza.flags.ignore_permissions = True
                    finanza.save(ignore_permissions=True)
                except Exception as e:
                    frappe.log_error(frappe.get_traceback(), "SYNC-UPDATE-FINANZA-ERROR")

        return {"status": "success", "message": "Caja Chica guardada correctamente", "doc": doc.as_dict()}

    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "SAVE-CAJA-CHICA-ERROR")
        return {"status": "error", "message": str(e)}

def recalculate_caja_balance(caja_name):
    try:
        doc = frappe.get_doc("Caja Chica", caja_name)
        total_pagado = 0

        # Collect all payment IDs from the child table
        payment_ids = [p.serie for p in doc.pagos if p.serie]

        if payment_ids:
            # Sum amounts of all active payments
            total_pagado = frappe.db.get_value("Pago Finanzas P", {"name": ["in", payment_ids]}, "sum(monto)") or 0

        doc.saldo_restante = flt(doc.monto) - flt(total_pagado)

        # Auto-close if balance is zero or less
        if doc.saldo_restante <= 0 and doc.estado == "Abierta":
            doc.estado = "Cerrada"
            _sync_finanza_status(caja_name, "Cerrada")

        doc.db_set("saldo_restante", doc.saldo_restante)
        doc.db_set("estado", doc.estado)
        return doc.saldo_restante
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "RECALCULATE-BALANCE-ERROR")
        return 0

@frappe.whitelist()
def create_payment(caja_name, monto, fecha, modo_pago=None, categoria_pago=None, notas=None, adjuntos=None):
    _require_admin()

    try:
        import json
        if isinstance(adjuntos, str): adjuntos = json.loads(adjuntos)

        if not modo_pago:
            return {"status": "error", "message": "Debe seleccionar un método de pago"}

        # 1. Create Payment Record
        pago = frappe.new_doc("Pago Finanzas P")
        pago.monto = monto
        pago.fecha_hora_pago = fecha or nowdate()
        pago.modo_pago = modo_pago
        pago.categoria_pago = categoria_pago
        pago.notas = notas

        if adjuntos:
            for adj in adjuntos:
                cat_name = adj.get("categoria")
                if cat_name and not frappe.db.exists("Categoria Pago", cat_name):
                    try:
                        c = frappe.new_doc("Categoria Pago")
                        c.nombre = cat_name
                        c.flags.ignore_permissions = True
                        c.insert(ignore_permissions=True)
                    except Exception:
                        frappe.log_error(frappe.get_traceback(), "AUTOCREATE-CAT-PAGO-ADJ-ERROR")

                final_cat = cat_name if cat_name and frappe.db.exists("Categoria Pago", cat_name) else None
                pago.append("adjuntos_pagos", {
                    "adjunto": adj.get("archivo"),
                    "categoria_pago": final_cat
                })

        pago.insert()

        # 2. Link to Caja Chica
        caja = frappe.get_doc("Caja Chica", caja_name)
        caja.append("pagos", {
            "serie": pago.name
        })
        caja.save()

        # 3. Replicar pago en Finanza Corporativa enlazada
        finanza_name = _get_finanza_for_caja(caja_name)
        if finanza_name:
            try:
                finanza = frappe.get_doc("Finanzas Corporativas", finanza_name)
                finanza.append("pagos", {
                    "serie": pago.name
                })

                # Calcular total pagado para actualizar estado
                total_paid = float(pago.monto)
                for row in finanza.pagos:
                    if row.serie and row.serie != pago.name:
                        val = frappe.db.get_value("Pago Finanzas P", row.serie, "monto") or 0
                        total_paid += float(val)

                if total_paid >= float(finanza.monto):
                    finanza.estado = "Pagado"
                    finanza.recordatorio_activo = 0

                finanza.flags.ignore_permissions = True
                finanza.save(ignore_permissions=True)
            except Exception as e:
                frappe.log_error(frappe.get_traceback(), "SYNC-PAYMENT-FINANZA-ERROR")

        # 4. Recalculate saldo_restante
        new_balance = recalculate_caja_balance(caja_name)

        return {"status": "success", "message": "Pago registrado", "data": pago.as_dict(), "saldo_restante": new_balance}

    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "CREATE-PAYMENT-CCH-ERROR")
        return {"status": "error", "message": str(e)}

@frappe.whitelist()
def delete_payment(name, caja_name):
    _require_admin()

    try:
        # 1. Remove from Caja Chica child table
        frappe.db.sql(
            "DELETE FROM `tabPago finanzas P Asociado` WHERE parent = %s AND serie = %s",
            (caja_name, name)
        )

        # 2. Remove from linked Finanzas Corporativas child table (if any)
        finanza_rows = frappe.db.sql(
            """
            SELECT parent FROM `tabPago finanzas P Asociado`
            WHERE serie = %s AND parenttype = 'Finanzas Corporativas'
            """,
            (name,),
            as_dict=True
        )
        frappe.db.sql(
            """
            DELETE FROM `tabPago finanzas P Asociado`
            WHERE serie = %s AND parenttype = 'Finanzas Corporativas'
            """,
            (name,)
        )

        # 3. Delete Payment doc
        frappe.delete_doc("Pago Finanzas P", name, ignore_permissions=True)

        # 4. Recalculate caja saldo
        recalculate_caja_balance(caja_name)

        # 5. Reset Finanzas Corporativas estado (since total_paid dropped)
        for row in finanza_rows:
            try:
                finanza = frappe.get_doc("Finanzas Corporativas", row.parent)
                total_paid = 0
                for r in finanza.pagos:
                    if r.serie:
                        val = frappe.db.get_value("Pago Finanzas P", r.serie, "monto") or 0
                        total_paid += float(val)
                if total_paid < float(finanza.monto or 0) and finanza.estado == "Pagado":
                    finanza.estado = "Pendiente"
                finanza.flags.ignore_permissions = True
                finanza.save(ignore_permissions=True)
            except Exception:
                frappe.log_error(frappe.get_traceback(), "SYNC-DELETE-FINANZA-ERROR")

        return {"status": "success", "message": "Pago eliminado"}
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "DELETE-PAYMENT-ERROR")
        return {"status": "error", "message": str(e)}

@frappe.whitelist()
def delete_caja(name):
    _require_admin()

    try:
        frappe.delete_doc("Caja Chica", name)
        return {"status": "success", "message": "Caja Chica eliminada"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@frappe.whitelist()
def close_caja_manual(name):
    _require_admin()

    try:
        doc = frappe.get_doc("Caja Chica", name)
        doc.estado = "Cerrada"
        doc.save()
        _sync_finanza_status(name, "Cerrada")
        return {"status": "success", "message": "Caja Chica cerrada correctamente"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


# ========= Gastos de Distribucion integrados =========
# Estos endpoints son usados desde la UI de /caja_chica para gestionar
# Gastos de Distribucion vinculados a una Caja Chica. Requieren tanto
# acceso a caja (Finhub-Caja-*) como a gastos distribucion
# (Finhub-Finanzas-*).


@frappe.whitelist()
def get_gastos_distribucion_initial_data():
    _require_view()
    if not _has_gd_view():
        frappe.throw(
            "Acceso denegado. Requiere uno de los roles: "
            + ", ".join(GD_VIEW_ROLES),
            frappe.PermissionError,
        )

    categorias = frappe.get_all(
        "Categoria Gasto Distribucion",
        fields=["name", "activo"],
        order_by="name asc"
    )
    categorias = [c for c in categorias if c.get("activo")]
    metodos_pago = frappe.get_all("Metodo Pago", fields=["name"], order_by="name asc")
    cat_adjuntos = frappe.get_all("Categoria Adjuntos Finanzas", fields=["name"], order_by="name asc")

    return {
        "status": "success",
        "categorias": [c.name for c in categorias],
        "metodos_pago": [m.name for m in metodos_pago],
        "categorias_adjuntos": [c.name for c in cat_adjuntos],
        "can_edit": _has_gd_admin()
    }


@frappe.whitelist()
def get_gastos_distribucion_by_caja(caja_name):
    _require_view()
    if not _has_gd_view():
        frappe.throw(
            "Acceso denegado. Requiere uno de los roles: "
            + ", ".join(GD_VIEW_ROLES),
            frappe.PermissionError,
        )

    gastos = frappe.get_all(
        "Gastos de Distribucion",
        filters={"caja_chica": caja_name},
        fields=[
            "name", "fecha", "categoria", "monto", "metodo_pago", "estado",
            "descripcion", "empleado", "creation",
            "pago_finanzas_p"
        ],
        order_by="fecha desc, creation desc",
        limit=200
    )

    if gastos:
        names = [g.name for g in gastos]
        adjuntos = frappe.get_all(
            "Finanzas Adjuntos Asociado",
            filters={"parent": ["in", names], "parenttype": "Gastos de Distribucion"},
            fields=["parent", "categoria", "archivo"]
        )
        adj_map = {}
        for a in adjuntos:
            adj_map.setdefault(a.parent, []).append({"categoria": a.categoria, "archivo": a.archivo})

        pedidos_rows = frappe.get_all(
            "Pedido Gasto Distribucion",
            filters={"parent": ["in", names], "parenttype": "Gastos de Distribucion"},
            fields=["parent", "pedido_tipo", "pedido", "cliente", "monto", "idx"],
            order_by="idx asc"
        )
        ped_map = {}
        for p in pedidos_rows:
            ped_map.setdefault(p.parent, []).append({
                "pedido_tipo": p.pedido_tipo,
                "pedido": p.pedido,
                "cliente": p.cliente,
                "monto": flt(p.monto)
            })

        for g in gastos:
            g["adjuntos"] = adj_map.get(g.name, [])
            g["pedidos"] = ped_map.get(g.name, [])

    return {"status": "success", "rows": gastos}


@frappe.whitelist()
def create_gasto_distribucion_from_caja(caja_name, data):
    _require_admin()
    if not _has_gd_admin():
        frappe.throw(
            "Acceso denegado. Requiere el rol: "
            + ", ".join(GD_ADMIN_ROLES),
            frappe.PermissionError,
        )

    import json as _json
    if isinstance(data, str):
        data = _json.loads(data)

    caja = frappe.db.get_value(
        "Caja Chica", caja_name,
        ["estado", "saldo_restante", "fecha"],
        as_dict=True
    )
    if not caja:
        return {"status": "error", "message": "Caja Chica no encontrada"}
    if caja.estado != "Abierta":
        return {"status": "error", "message": "La caja no esta Abierta"}

    monto = flt(data.get("monto"))
    if monto <= 0:
        return {"status": "error", "message": "Monto invalido"}
    if monto > flt(caja.saldo_restante):
        return {"status": "error", "message": f"Saldo insuficiente. Disponible: S/ {flt(caja.saldo_restante):.2f}"}

    metodo_pago = data.get("metodo_pago") or None
    if not metodo_pago:
        return {"status": "error", "message": "Metodo de pago requerido"}

    categoria = data.get("categoria")
    if not categoria:
        return {"status": "error", "message": "Categoria requerida"}

    adjuntos_raw = data.get("adjuntos") or []
    fecha = data.get("fecha") or nowdate()

    try:
        existing_name = data.get("name")
        if existing_name:
            doc_gd = frappe.get_doc("Gastos de Distribucion", existing_name)
        else:
            doc_gd = frappe.new_doc("Gastos de Distribucion")

        doc_gd.fecha = fecha
        doc_gd.categoria = categoria
        doc_gd.monto = monto
        doc_gd.metodo_pago = metodo_pago
        doc_gd.estado = data.get("estado") or "Pagado"
        doc_gd.descripcion = data.get("descripcion")
        doc_gd.empleado = data.get("empleado") or None
        doc_gd.caja_chica = caja_name

        # Pedidos vinculados (0..N)
        from finhub.www.gastos_distribucion.index import _apply_pedidos
        _apply_pedidos(doc_gd, data)

        doc_gd.set("adjuntos", [])
        for item in adjuntos_raw:
            doc_gd.append("adjuntos", {
                "categoria": item.get("categoria"),
                "archivo": item.get("archivo")
            })
        doc_gd.save()

        pago_adjuntos = [
            {"archivo": item.get("archivo"), "categoria": item.get("categoria") or "Comprobante"}
            for item in adjuntos_raw if item.get("archivo")
        ]

        # Auto-create Categoria Pago si no existe (Pago Finanzas P.categoria_pago
        # links to "Categoria Pago", distinto de "Categoria Gasto Distribucion").
        categoria_pago_name = None
        if categoria:
            if not frappe.db.exists("Categoria Pago", categoria):
                try:
                    cp = frappe.new_doc("Categoria Pago")
                    cp.nombre = categoria
                    cp.flags.ignore_permissions = True
                    cp.insert(ignore_permissions=True)
                except Exception:
                    frappe.log_error(frappe.get_traceback(), "AUTOCREATE-CAT-PAGO-ERROR")
            categoria_pago_name = categoria if frappe.db.exists("Categoria Pago", categoria) else None

        pay_res = create_payment(
            caja_name=caja_name,
            monto=monto,
            fecha=fecha,
            modo_pago=metodo_pago,
            categoria_pago=categoria_pago_name,
            notas=data.get("descripcion"),
            adjuntos=pago_adjuntos
        )
        if pay_res.get("status") != "success":
            # rollback: delete gasto creado
            try:
                frappe.delete_doc("Gastos de Distribucion", doc_gd.name, ignore_permissions=True)
            except Exception:
                pass
            return pay_res

        pago_name = pay_res["data"]["name"]
        doc_gd.db_set("pago_finanzas_p", pago_name)

        return {
            "status": "success",
            "message": "Gasto registrado y descontado de caja",
            "name": doc_gd.name,
            "pago": pago_name,
            "saldo_restante": pay_res.get("saldo_restante")
        }

    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "CREATE-GD-FROM-CAJA-ERROR")
        return {"status": "error", "message": str(e)}


@frappe.whitelist()
def delete_gasto_distribucion_from_caja(gasto_name, caja_name=None):
    _require_admin()
    if not _has_gd_admin():
        frappe.throw(
            "Acceso denegado. Requiere el rol: "
            + ", ".join(GD_ADMIN_ROLES),
            frappe.PermissionError,
        )

    try:
        from finhub.www.gastos_distribucion.index import _delete_gasto_cascade
        res = _delete_gasto_cascade(gasto_name)
        if res.get("status") == "success" and caja_name:
            res["saldo_restante"] = frappe.db.get_value("Caja Chica", caja_name, "saldo_restante")
        return res
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "DELETE-GD-FROM-CAJA-ERROR")
        return {"status": "error", "message": str(e)}


@frappe.whitelist()
def search_pedidos_for_gasto(tipo, q=None, limit=20):
    _require_view()
    if not _has_gd_view():
        frappe.throw(
            "Acceso denegado. Requiere uno de los roles: "
            + ", ".join(GD_VIEW_ROLES),
            frappe.PermissionError,
        )
    from finhub.www.gastos_distribucion.index import search_pedidos as _search
    return _search(tipo, q, limit)

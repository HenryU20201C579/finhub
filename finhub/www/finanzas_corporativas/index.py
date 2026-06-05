import os
import frappe
import requests
from frappe import _
from frappe.utils import getdate, nowdate, add_days


ADMIN_ROLES = ("Finhub-Finanzas-Administrar",)
VIEW_ROLES = ("Finhub-Finanzas-Ver", "Finhub-Finanzas-Administrar")  # admin implica viewer


def _is_admin_finanzas():
    return any(r in frappe.get_roles() for r in ADMIN_ROLES)


def _can_view_finanzas():
    return any(r in frappe.get_roles() for r in VIEW_ROLES)


def _require_view():
    if not _can_view_finanzas():
        return {"status": "error", "message": "Acceso denegado. Se requiere Finhub-Finanzas-Ver o Finhub-Finanzas-Administrar."}
    return None


def _require_admin():
    if not _is_admin_finanzas():
        return {"status": "error", "message": "Acceso denegado. Se requiere Finhub-Finanzas-Administrar."}
    return None


def get_context(context):
    context.title = _("Finanzas Corporativas")
    context.no_cache = 1
    if not _can_view_finanzas():
        context.no_access = True
        context.has_access = False
        context.required_roles = list(VIEW_ROLES)
        return
    context.has_access = True
    context.can_edit = _is_admin_finanzas()
##
@frappe.whitelist()
def get_initial_data():
    err = _require_view()
    if err: return err

    # Fetch Categories
    categories = frappe.get_all(
        "Categoria Gasto",
        fields=["name", "tipo_gasto", "icono_imagen", "icono", "color"],
        order_by="name asc"
    )
    
    # Fetch Payment Methods
    payment_methods = frappe.get_all("Metodo Pago", fields=["name"], order_by="name asc")

    # Fetch Attachment Categories
    attachment_categories = frappe.get_all("Categoria Adjuntos Finanzas", fields=["name"], order_by="name asc")

    # Fetch Payment Categories
    payment_categories = frappe.get_all("Categoria Pago", fields=["nombre"], order_by="nombre asc")

    # Fetch ERPNext Options (Mode of Payment and Bank Account)
    erp_payment_modes = frappe.get_all("Mode of Payment", fields=["name"], order_by="name asc")
    # Use Bank Account doctype to get the identifiable names (e.g. BCP - BCP)
    erp_bank_accounts = frappe.get_all("Bank Account", fields=["name", "account"], order_by="name asc")

    return {
        "categories": categories,
        "payment_methods": [p.name for p in payment_methods],
        "attachment_categories": [c.name for c in attachment_categories],
        "payment_categories": [c.nombre for c in payment_categories],
        "erp_payment_modes": [p.name for p in erp_payment_modes],
        "erp_bank_accounts": [{"name": ba.name, "account": ba.account} for ba in erp_bank_accounts]
    }
#
#
@frappe.whitelist()
def get_expenses(filters=None):
    err = _require_view()
    if err: return err
    
    import json
    if isinstance(filters, str):
        filters = json.loads(filters)
    
    conditions = {}
    if filters:
        if filters.get("category"):
            conditions["categoria"] = filters.get("category")
        
        # Dashboard Monthly strict filter
        if filters.get("month_date"):
            from frappe.utils import get_first_day, get_last_day, getdate
            d_date = getdate(filters["month_date"])
            conditions["fecha"] = ["between", [get_first_day(d_date), get_last_day(d_date)]]
            
        elif filters.get("start_date") and filters.get("end_date"):
            conditions["fecha"] = ["between", [filters["start_date"], filters["end_date"]]]

    expenses = frappe.get_all("Finanzas Corporativas", 
        filters=conditions,
        fields=["name", "fecha", "categoria", "categoria.tipo_gasto as tipo", "monto", "metodo_pago", "descripcion", "fecha_vencimiento", "estado", "recordatorio_activo", "proveedor", "ruc", "estado_contador", "orden_compra", "empleado", "empleado.employee_name as empleado_nombre"],
        order_by="`tabFinanzas Corporativas`.fecha desc, `tabFinanzas Corporativas`.creation desc",
        limit=500
    )

    # Fetch Attachments and Payments for these expenses
    if expenses:
        names = [d.name for d in expenses]
        
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

        # 2. Payments
        linked_payments = frappe.get_all("Pago finanzas P Asociado",
            filters={"parent": ["in", names]},
            fields=["parent", "serie"]
        )
        
        payment_ids = [lp.serie for lp in linked_payments if lp.serie]
        payments_details = {}
        
        if payment_ids:
            p_docs = frappe.get_all("Pago Finanzas P",
                filters={"name": ["in", payment_ids]},
                fields=["name", "fecha_hora_pago", "monto", "modo_pago", "creation", "modo_pago_compra", "cuenta_de_banco", "entrada_pago"]
            )
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

        for exp in expenses:
            exp.adjuntos = att_map.get(exp.name, [])
            exp.pagos = exp_pay_map.get(exp.name, [])

    return expenses

@frappe.whitelist()
def save_expense(data):
    err = _require_admin()
    if err: return err

    import json
    if isinstance(data, str):
        data = json.loads(data)

    try:
        if data.get("name"):
            doc = frappe.get_doc("Finanzas Corporativas", data.get("name"))
        else:
            doc = frappe.new_doc("Finanzas Corporativas")
        
        doc.fecha = data.get("fecha") or nowdate()
        doc.categoria = data.get("categoria")
        doc.monto = data.get("monto")
        doc.metodo_pago = data.get("metodo_pago")
        doc.descripcion = data.get("descripcion")
        doc.proveedor = data.get("proveedor")
        doc.ruc = data.get("ruc")
        doc.estado_contador = data.get("estado_contador") or "Pendiente"
        if data.get("empleado"):
            doc.empleado = data.get("empleado")
        elif not data.get("name"):
            doc.empleado = None
        
        # Child Table: Adjuntos
        doc.set("adjuntos", [])
        if data.get("adjuntos"):
            for item in data.get("adjuntos"):
                doc.append("adjuntos", {
                    "categoria": item.get("categoria"),
                    "archivo": item.get("archivo")
                })

        tipo_gasto = frappe.db.get_value("Categoria Gasto", doc.categoria, "tipo_gasto") or "Variable"
        
        doc.fecha_vencimiento = data.get("fecha_vencimiento")
        doc.estado = data.get("estado") or "Pendiente"
        
        if doc.estado == "Pagado":
            doc.recordatorio_activo = 0
        else:
            doc.recordatorio_activo = 1 if data.get("recordatorio_activo") else 0

        doc.save(ignore_permissions=True)
        frappe.db.commit() # Force commit for immediate visibility in whitelisted call
        
        response_doc = doc.as_dict()
        response_doc['tipo'] = tipo_gasto
        return {"status": "success", "message": "Gasto corporativo guardado correctamente", "doc": response_doc}

    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "SAVE-CORP-EXPENSE-ERROR")
        return {"status": "error", "message": str(e)}

@frappe.whitelist()
def create_payment(expense_name, monto, fecha, modo_pago=None, adjuntos=None, modo_pago_compra=None, cuenta_de_banco=None):
    err = _require_admin()
    if err: return err
        
    try:
        import json
        if isinstance(adjuntos, str): adjuntos = json.loads(adjuntos)
        
        if not modo_pago:
            return {"status": "error", "message": "Debe seleccionar un método de pago"}

        pago = frappe.new_doc("Pago Finanzas P")
        pago.monto = monto
        pago.fecha_hora_pago = fecha or nowdate()
        pago.modo_pago = modo_pago
        pago.modo_pago_compra = modo_pago_compra
        pago.cuenta_de_banco = cuenta_de_banco
        
        if adjuntos:
            for adj in adjuntos:
                 cat_name = adj.get("categoria")
                 if cat_name and not frappe.db.exists("Categoria Pago", cat_name):
                     if cat_name == "Comprobante":
                         c = frappe.new_doc("Categoria Pago")
                         c.nombre = "Comprobante"
                         c.insert()
                     else:
                         frappe.throw(f"La categoría de pago '{cat_name}' no existe.")

                 pago.append("adjuntos_pagos", {
                     "adjunto": adj.get("archivo"),
                     "categoria_pago": cat_name
                 })
        
        pago.insert()
        
        expense = frappe.get_doc("Finanzas Corporativas", expense_name)
        expense.append("pagos", {
            "serie": pago.name
        })
        
        total_paid = float(pago.monto)
        for row in expense.pagos:
            if row.serie and row.serie != pago.name:
                 val = frappe.db.get_value("Pago Finanzas P", row.serie, "monto") or 0
                 total_paid += float(val)
        
        if total_paid >= expense.monto:
            expense.estado = "Pagado"
            expense.recordatorio_activo = 0
        
        expense.save()

        # ── Sincronizar con Payment Entry ERPNext (si hay Factura asociada) ───
        try:
            if expense.orden_compra:
                # La vinculación entre PI y PO está en la tabla de ítems (Purchase Invoice Item), no en el header.
                pi_name = frappe.db.get_value("Purchase Invoice Item",
                    {"purchase_order": expense.orden_compra, "docstatus": ["!=", 2]}, "parent")

            if pi_name:
                pi_doc = frappe.get_doc("Purchase Invoice", pi_name)

                pe = frappe.new_doc("Payment Entry")
                pe.payment_type       = "Pay"
                pe.party_type         = "Supplier"
                pe.party              = pi_doc.supplier
                pe.posting_date       = fecha or nowdate()
                pe.paid_amount        = float(monto)
                pe.received_amount    = float(monto)
                pe.company            = pi_doc.company
                pe.paid_from_account_currency = pi_doc.currency
                pe.paid_to_account_currency   = pi_doc.currency
                
                # New mappings
                if pago.modo_pago_compra:
                    pe.mode_of_payment = pago.modo_pago_compra
                if pago.cuenta_de_banco:
                    # Resolve ledger account from Bank Account name
                    ledger_acc = frappe.db.get_value("Bank Account", pago.cuenta_de_banco, "account")
                    pe.paid_from = ledger_acc or pago.cuenta_de_banco

                pe.append("references", {
                    "reference_doctype": "Purchase Invoice",
                    "reference_name":    pi_name,
                    "allocated_amount":  float(monto),
                    "outstanding_amount": pi_doc.outstanding_amount
                })

                if adjuntos:
                    for adj in adjuntos:
                        pe.append("custom_adjuntos", {
                            "adjunto":        adj.get("archivo"),
                            "categoria_pago": adj.get("categoria")
                        })

                pe.flags.ignore_mandatory = True
                pe.insert()
                
                # Intentar validar, pero si faltan cuentas queda como Borrador
                try:
                    pe.submit()
                except Exception:
                    frappe.log_error(frappe.get_traceback(), "PE Sync: Submit skipped (missing accounts?)")

                # Guardar el link SIEMPRE (aunque este en Borrador)
                frappe.db.set_value("Pago Finanzas P", pago.name,
                                    "entrada_pago", pe.name)
                frappe.db.commit()
            else:
                frappe.log_error(f"No se encontró PI para la OC {expense.orden_compra}", "PAY-SYNC-DEBUG")

        except Exception as pe_err:
            frappe.log_error(frappe.get_traceback(), "Error sincronizando Payment Entry")
        # ─────────────────────────────────────────────────────────────────────

        return {"status": "success", "message": "Pago registrado", "data": pago.as_dict(), "new_status": expense.estado}
        
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "CREATE-CORP-PAYMENT-ERROR")
        return {"status": "error", "message": str(e)}

@frappe.whitelist()
def delete_payment(payment_name, expense_name):
    err = _require_admin()
    if err: return err
    
    try:
        expense = frappe.get_doc("Finanzas Corporativas", expense_name)
        
        found = False
        remaining_rows = []
        for row in expense.pagos:
            if row.serie == payment_name:
                found = True
            else:
                remaining_rows.append(row)
        
        if found:
            expense.pagos = remaining_rows
            expense.save()
            
        if frappe.db.exists("Pago Finanzas P", payment_name):
            frappe.delete_doc("Pago Finanzas P", payment_name)
            
        expense.reload()
        
        total_paid = 0
        for row in expense.pagos:
            if row.serie:
                 val = frappe.db.get_value("Pago Finanzas P", row.serie, "monto") or 0
                 total_paid += float(val)
        
        if total_paid >= expense.monto:
             expense.estado = "Pagado"
             expense.recordatorio_activo = 0
        else:
             expense.estado = "Pendiente"
             expense.recordatorio_activo = 1
        
        expense.save()
        
        return {"status": "success", "message": "Pago eliminado", "new_status": expense.estado}

    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "DELETE-CORP-PAYMENT-ERROR")
        return {"status": "error", "message": str(e)}

@frappe.whitelist()
def update_payment(payment_name, expense_name, monto, fecha, modo_pago, adjuntos=None, modo_pago_compra=None, cuenta_de_banco=None):
    err = _require_admin()
    if err: return err

    try:
        import json
        if isinstance(adjuntos, str): adjuntos = json.loads(adjuntos)
        
        pago = frappe.get_doc("Pago Finanzas P", payment_name)
        pago.monto = monto
        pago.fecha_hora_pago = fecha
        pago.modo_pago = modo_pago
        pago.modo_pago_compra = modo_pago_compra
        pago.cuenta_de_banco = cuenta_de_banco
        
        existing_attachments = pago.adjuntos_pagos
        existing_urls = [d.adjunto for d in existing_attachments]
        new_urls = [d.get("archivo") for d in (adjuntos or [])]
        
        for url in existing_urls:
            if url not in new_urls:
                try:
                    file_name = frappe.db.get_value("File", {"file_url": url}, "name")
                    if file_name:
                        frappe.delete_doc("File", file_name)
                except Exception as e:
                    frappe.log_error(f"Error deleting file {url}: {str(e)}", "PAYMENT_CORP_FILE_CLEANUP")

        pago.set("adjuntos_pagos", [])
        if adjuntos:
             for adj in adjuntos:
                 cat_name = adj.get("categoria")
                 if cat_name and not frappe.db.exists("Categoria Pago", cat_name):
                     if cat_name == "Comprobante":
                         c = frappe.new_doc("Categoria Pago")
                         c.nombre = "Comprobante"
                         c.insert()
                 
                 pago.append("adjuntos_pagos", {
                     "adjunto": adj.get("archivo"),
                     "categoria_pago": cat_name
                 })
        
        pago.save()
        
        expense = frappe.get_doc("Finanzas Corporativas", expense_name)
        
        total_paid = 0
        for row in expense.pagos:
            if row.serie:
                 val = frappe.db.get_value("Pago Finanzas P", row.serie, "monto") or 0
                 total_paid += float(val)

        if total_paid >= expense.monto:
             expense.estado = "Pagado"
             expense.recordatorio_activo = 0
        else:
             expense.estado = "Pendiente"
             expense.recordatorio_activo = 1
        
        expense.save()
        
        return {"status": "success", "message": "Pago actualizado", "data": pago.as_dict(), "new_status": expense.estado}

    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "UPDATE-CORP-PAYMENT-ERROR")
        return {"status": "error", "message": str(e)}

@frappe.whitelist()
def delete_expense(name):
    err = _require_admin()
    if err: return err
    
    try:
        frappe.delete_doc("Finanzas Corporativas", name)
        return {"status": "success", "message": "Gasto eliminado"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@frappe.whitelist()
def fix_file_extension(file_url, correct_ext):
    """Fix file_url extension when Frappe deduplication returns wrong extension"""
    err = _require_admin()
    if err: return err

    try:
        correct_ext = correct_ext.lower().strip()
        if correct_ext not in ['.pdf', '.jpg', '.jpeg', '.png', '.webp']:
            return {"status": "error", "message": "Extensión no permitida"}

        # Find the File doc by file_url
        file_doc = frappe.get_value("File", {"file_url": file_url}, ["name", "file_url", "file_name"], as_dict=True)
        if not file_doc:
            return {"status": "error", "message": "Archivo no encontrado"}

        current_ext = os.path.splitext(file_doc.file_url)[1].lower()
        if current_ext == correct_ext:
            return {"status": "ok", "file_url": file_doc.file_url}

        # Build new file_url with correct extension
        base = os.path.splitext(file_doc.file_url)[0]
        new_file_url = base + correct_ext

        # Rename physical file on disk
        site_path = frappe.get_site_path("public")
        old_path = os.path.join(site_path, file_doc.file_url.lstrip("/"))
        new_path = os.path.join(site_path, new_file_url.lstrip("/"))

        if os.path.exists(old_path) and not os.path.exists(new_path):
            os.rename(old_path, new_path)

        # Update File doc
        frappe.db.set_value("File", file_doc.name, "file_url", new_file_url)
        frappe.db.commit()

        return {"status": "ok", "file_url": new_file_url}

    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "FIX-FILE-EXTENSION-ERROR")
        return {"status": "error", "message": str(e)}

@frappe.whitelist()
def create_category(name, tipo, icono_imagen=None, color=None, icono=None):
    err = _require_admin()
    if err: return err

    try:
        doc = frappe.new_doc("Categoria Gasto")
        doc.nombre = name
        doc.tipo_gasto = tipo
        if icono_imagen:
            doc.icono_imagen = icono_imagen
        if icono:
            doc.icono = icono
        if color:
            doc.color = color
        doc.insert()
        return {
            "status": "success",
            "message": "Categoría creada",
            "data": {
                "name": doc.name,
                "tipo_gasto": doc.tipo_gasto,
                "icono_imagen": doc.icono_imagen,
                "icono": doc.icono,
                "color": doc.color
            }
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}


@frappe.whitelist()
def update_category_appearance(name, icono_imagen=None, color=None, icono=None):
    err = _require_admin()
    if err: return err

    try:
        doc = frappe.get_doc("Categoria Gasto", name)
        doc.icono_imagen = icono_imagen
        doc.icono = icono
        doc.color = color
        doc.save()
        return {
            "status": "success",
            "message": "Apariencia actualizada",
            "data": {
                "name": doc.name,
                "icono_imagen": doc.icono_imagen,
                "icono": doc.icono,
                "color": doc.color
            }
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}

@frappe.whitelist()
def delete_category(name):
    err = _require_admin()
    if err: return err
    
    try:
        # Check if any expense record is using this category
        if frappe.db.exists("Finanzas Corporativas", {"categoria": name}):
            return {"status": "error", "message": f"No se puede eliminar la categoría '{name}' porque está siendo usada por uno o más registros."}
        
        # Delete the category
        frappe.delete_doc("Categoria Gasto", name)
        return {"status": "success", "message": "Categoría eliminada correctamente"}
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "DELETE-CATEGORY-ERROR")
        return {"status": "error", "message": str(e)}


@frappe.whitelist()
def merge_categories(old_names, new_name, new_tipo,
                     new_icono=None, new_color=None, new_icono_imagen=None,
                     prefix_desc=True, dry_run=False):
    """
    Fusiona varias categorias origen en una categoria destino.
    - Crea/reusa la categoria destino con su tipo + apariencia opcional.
    - Migra todos los `Finanzas Corporativas` de cada old_name a new_name.
    - Preserva el nombre viejo en `descripcion` del registro:
      * desc vacia -> desc = old_name
      * desc existente + prefix_desc=True -> desc = f"{old_name} | {old_desc}"
    - Elimina categorias origen que queden sin records.
    - Si dry_run=True, no modifica nada, solo devuelve el plan.
    """
    err = _require_admin()
    if err: return err

    import json as _json
    if isinstance(old_names, str):
        old_names = _json.loads(old_names)
    # prefix_desc puede venir como string "true"/"false" desde frappe.call
    if isinstance(prefix_desc, str):
        prefix_desc = prefix_desc.lower() not in ("false", "0", "")
    if isinstance(dry_run, str):
        dry_run = dry_run.lower() not in ("false", "0", "")

    result = {
        "new_name": new_name,
        "new_tipo": new_tipo,
        "migrated_records": 0,
        "deleted_categories": [],
        "details": []
    }

    try:
        # 1. Crear/reusar categoria destino
        if not frappe.db.exists("Categoria Gasto", new_name):
            if not dry_run:
                doc = frappe.new_doc("Categoria Gasto")
                doc.nombre = new_name
                doc.tipo_gasto = new_tipo
                if new_icono:
                    doc.icono = new_icono
                if new_color:
                    doc.color = new_color
                if new_icono_imagen:
                    doc.icono_imagen = new_icono_imagen
                doc.insert(ignore_permissions=True)
            result["details"].append(f"CREAR categoria destino '{new_name}' ({new_tipo})")
        else:
            result["details"].append(f"REUSAR categoria destino existente '{new_name}'")

        # 2. Migrar records por cada old_name
        for old in old_names:
            if old == new_name:
                result["details"].append(f"  SKIP origen == destino: '{old}'")
                continue

            if not frappe.db.exists("Categoria Gasto", old):
                result["details"].append(f"  AVISO: origen '{old}' no existe, se omite")
                continue

            records = frappe.get_all(
                "Finanzas Corporativas",
                filters={"categoria": old},
                fields=["name", "descripcion"]
            )
            for r in records:
                old_desc = r.descripcion or ""
                if old_desc:
                    new_desc = f"{old} | {old_desc}" if prefix_desc else old_desc
                else:
                    new_desc = old

                if not dry_run:
                    frappe.db.set_value(
                        "Finanzas Corporativas",
                        r.name,
                        {"categoria": new_name, "descripcion": new_desc}
                    )
                result["migrated_records"] += 1
                result["details"].append(
                    f"  {r.name}: '{old}' -> '{new_name}' | desc='{new_desc[:70]}'"
                )

            # 3. Eliminar categoria origen si quedo vacia
            remaining = frappe.db.count("Finanzas Corporativas", {"categoria": old})
            if remaining == 0:
                if not dry_run and frappe.db.exists("Categoria Gasto", old):
                    frappe.delete_doc("Categoria Gasto", old, ignore_permissions=True)
                result["deleted_categories"].append(old)
                result["details"].append(f"  ELIMINAR origen vacio '{old}'")
            else:
                result["details"].append(
                    f"  AVISO: '{old}' aun tiene {remaining} records (no se elimina)"
                )

        if not dry_run:
            frappe.db.commit()

        result["status"] = "success"
        result["dry_run"] = dry_run
        return result

    except Exception as e:
        if not dry_run:
            frappe.db.rollback()
        frappe.log_error(frappe.get_traceback(), "MERGE-CATEGORIES-ERROR")
        return {"status": "error", "message": str(e), "details": result.get("details", [])}


@frappe.whitelist()
def delete_empty_categories(names):
    """
    Elimina categorias de gasto que no tienen ningun record asociado.
    Skip y reporta error para las que si tienen records.
    """
    err = _require_admin()
    if err: return err

    import json as _json
    if isinstance(names, str):
        names = _json.loads(names)

    deleted = []
    errors = []

    for n in names:
        if not frappe.db.exists("Categoria Gasto", n):
            errors.append(f"{n}: no existe")
            continue
        count = frappe.db.count("Finanzas Corporativas", {"categoria": n})
        if count > 0:
            errors.append(f"{n}: tiene {count} records, no se elimina")
            continue
        try:
            frappe.delete_doc("Categoria Gasto", n, ignore_permissions=True)
            deleted.append(n)
        except Exception as e:
            errors.append(f"{n}: {e}")

    frappe.db.commit()
    return {"status": "success", "deleted": deleted, "errors": errors}


@frappe.whitelist()
def create_payment_method(name):
    err = _require_admin()
    if err: return err
    
    try:
        doc = frappe.new_doc("Metodo Pago")
        doc.nombre = name
        doc.insert()
        return {"status": "success", "message": "Método de pago creado", "data": {"name": doc.name}}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@frappe.whitelist()
def create_attachment_category(name):
    err = _require_admin()
    if err: return err
    
    try:
        doc = frappe.new_doc("Categoria Adjuntos Finanzas")
        doc.categoria_adjuntos = name
        doc.insert()
        return {"status": "success", "message": "Categoría de adjunto creada", "data": {"name": doc.name}}
    except Exception as e:
        return {"status": "error", "message": str(e)}

@frappe.whitelist()
def consultar_dni(dni):
    """Consulta DNI usando la API de Factiliza"""
    err = _require_view()
    if err: return err
    try:
        token = frappe.db.get_value("Credenciales", "Consulta DNI", "credencial")
        if not token:
            token = frappe.conf.get("factiliza_api_token")

        if not token:
            return {"success": False, "message": "Token de Factiliza no encontrado."}

        url = f"https://api.factiliza.com/v1/dni/info/{dni}"
        headers = {"Authorization": f"Bearer {token}"}
        response = requests.get(url, headers=headers, timeout=10)
        response.raise_for_status()
        data = response.json()

        if data.get("success"):
            return {"success": True, "data": data["data"]}
        else:
            return {"success": False, "message": data.get("message", "Error en la consulta")}
    except Exception as e:
        frappe.log_error(f"Error consultando DNI: {str(e)}", "Factiliza DNI Error")
        return {"success": False, "message": f"Error de consulta API"}

@frappe.whitelist()
def consultar_ruc(ruc):
    """Consulta RUC usando la API de Factiliza"""
    err = _require_view()
    if err: return err
    try:
        token = frappe.db.get_value("Credenciales", "Consulta DNI", "credencial")
        if not token:
            token = frappe.conf.get("factiliza_api_token")

        if not token:
            return {"success": False, "message": "Token de Factiliza no encontrado."}

        url = f"https://api.factiliza.com/v1/ruc/info/{ruc}"
        headers = {"Authorization": f"Bearer {token}"}
        response = requests.get(url, headers=headers, timeout=10)
        response.raise_for_status()
        data = response.json()

        if data.get("success"):
            return {"success": True, "data": data["data"]}
        else:
            return {"success": False, "message": data.get("message", "Error en la consulta")}
    except Exception as e:
        frappe.log_error(f"Error consultando RUC: {str(e)}", "Factiliza RUC Error")
        return {"success": False, "message": f"Error de consulta API"}
@frappe.whitelist()
def search_proveedores(query=None):
    err = _require_view()
    if err: return err

    if not query:
        # Return 5 most recent suppliers
        proveedores = frappe.db.sql("""
            SELECT name, ruc, nombre_razon_social, direccion 
            FROM `tabProveedor` 
            ORDER BY creation DESC
            LIMIT 5
        """, as_dict=True)
        return proveedores

    proveedores = frappe.db.sql("""
        SELECT name, ruc, nombre_razon_social, direccion 
        FROM `tabProveedor` 
        WHERE ruc LIKE %s OR nombre_razon_social LIKE %s
        ORDER BY creation DESC
        LIMIT 10
    """, (f"%{query}%", f"%{query}%"), as_dict=True)
    return proveedores

@frappe.whitelist()
def create_proveedor(data):
    err = _require_admin()
    if err: return err

    import json
    if isinstance(data, str):
        data = json.loads(data)

    try:
        if frappe.db.exists("Proveedor", data.get("ruc")):
            return {"status": "error", "message": f"El RUC {data.get('ruc')} ya está registrado."}

        doc = frappe.new_doc("Proveedor")
        doc.ruc = data.get("ruc")
        doc.nombre_razon_social = data.get("nombre_razon_social")
        doc.direccion = data.get("direccion")
        doc.departamento = data.get("departamento")
        doc.provincia = data.get("provincia")
        doc.distrito = data.get("distrito")
        doc.web = data.get("web")
        doc.insert()

        return {
            "status": "success",
            "message": "Proveedor creado correctamente",
            "data": doc.as_dict()
        }
    except Exception as e:
        frappe.log_error(frappe.get_traceback(), "CREATE-PROVEEDOR-ERROR")
        return {"status": "error", "message": str(e)}


# ─────────────────────────────────────────────────────────────────────────
# REPLICACION MENSUAL DE GASTOS FIJOS
# El dia 1 de cada mes, los gastos fijos del mes anterior (excepto la
# categoria 'Planilla' que tiene su propio mecanismo de sync) se replican
# en el mes nuevo con estado 'Pendiente'. Idempotente: re-correr no
# duplica. Match para no duplicar: (categoria, proveedor) o fallback a
# (categoria, descripcion) si no hay proveedor.
# ─────────────────────────────────────────────────────────────────────────

import calendar as _calendar
from datetime import date as _date


def _prev_month(target_year, target_month):
    """Devuelve (prev_year, prev_month) del mes anterior."""
    if target_month == 1:
        return target_year - 1, 12
    return target_year, target_month - 1


def _expense_match_key(exp):
    """Clave para detectar duplicados al replicar. Prioriza (categoria,
    proveedor); si no hay proveedor usa (categoria, descripcion truncada)."""
    cat = (exp.get("categoria") or "").strip()
    prov = (exp.get("proveedor") or "").strip()
    if prov:
        return (cat, "prov", prov)
    desc = (exp.get("descripcion") or "").strip()[:80]
    return (cat, "desc", desc)


def _replicate_fixed_expenses_for(target_year, target_month):
    """Genera los gastos fijos del mes target copiando del mes anterior.
    No-op si target ya tiene los gastos esperados. Devuelve resumen."""
    if not frappe.db.exists("DocType", "Finanzas Corporativas"):
        return {"status": "noop", "message": "Finanzas Corporativas no disponible"}

    prev_year, prev_month = _prev_month(target_year, target_month)
    prev_start = f"{prev_year}-{prev_month:02d}-01"
    _, prev_last = _calendar.monthrange(prev_year, prev_month)
    prev_end = f"{prev_year}-{prev_month:02d}-{prev_last}"

    target_start = f"{target_year}-{target_month:02d}-01"
    _, target_last = _calendar.monthrange(target_year, target_month)
    target_end = f"{target_year}-{target_month:02d}-{target_last}"

    # Gastos fijos del mes anterior (excepto Planilla y excepto Cancelados)
    rows_prev = frappe.db.sql("""
        SELECT fc.name, fc.categoria, fc.empleado, fc.monto,
               fc.metodo_pago, fc.descripcion, fc.recordatorio_activo,
               fc.proveedor, fc.ruc, fc.fecha_vencimiento, fc.estado,
               fc.caja_chica, fc.orden_compra,
               cg.tipo_gasto
        FROM `tabFinanzas Corporativas` fc
        LEFT JOIN `tabCategoria Gasto` cg ON cg.name = fc.categoria
        WHERE fc.fecha BETWEEN %s AND %s
          AND cg.tipo_gasto = 'Fijo'
          AND fc.categoria != 'Planilla'
          AND COALESCE(fc.estado, '') != 'Cancelado'
    """, (prev_start, prev_end), as_dict=True)

    if not rows_prev:
        return {
            "status": "noop",
            "message": f"Sin gastos fijos en {prev_year}-{prev_month:02d}",
            "creados": 0, "omitidos": 0,
        }

    # Gastos ya existentes del mes target (para evitar duplicar)
    rows_target = frappe.db.sql("""
        SELECT categoria, proveedor, descripcion
        FROM `tabFinanzas Corporativas`
        WHERE fecha BETWEEN %s AND %s
          AND categoria != 'Planilla'
    """, (target_start, target_end), as_dict=True)
    existing_keys = {_expense_match_key(r) for r in rows_target}

    creados = 0
    omitidos = 0
    detalles = []

    for exp in rows_prev:
        key = _expense_match_key(exp)
        if key in existing_keys:
            omitidos += 1
            continue

        # Construir el nuevo gasto. NO copiamos: name, fecha, estado, adjuntos, pagos.
        nuevo = frappe.get_doc({
            "doctype": "Finanzas Corporativas",
            "fecha": target_start,  # dia 1 del mes nuevo
            "categoria": exp.get("categoria"),
            "empleado": exp.get("empleado"),
            "monto": exp.get("monto"),
            "metodo_pago": exp.get("metodo_pago"),
            "descripcion": exp.get("descripcion"),
            "recordatorio_activo": exp.get("recordatorio_activo"),
            "proveedor": exp.get("proveedor"),
            "ruc": exp.get("ruc"),
            "caja_chica": exp.get("caja_chica"),
            "orden_compra": exp.get("orden_compra"),
            "estado": "Pendiente",
        })
        try:
            nuevo.flags.ignore_permissions = True
            nuevo.insert()
            creados += 1
            detalles.append({
                "categoria": exp.get("categoria"),
                "proveedor": exp.get("proveedor"),
                "monto": float(exp.get("monto") or 0),
                "doc": nuevo.name,
            })
            existing_keys.add(key)
        except Exception:
            frappe.log_error(frappe.get_traceback(), "REPLICATE-FIXED-EXPENSE")

    frappe.db.commit()

    return {
        "status": "success",
        "periodo": f"{target_year}-{target_month:02d}",
        "fuente": f"{prev_year}-{prev_month:02d}",
        "creados": creados,
        "omitidos": omitidos,
        "detalles": detalles,
        "message": f"{creados} gasto(s) replicado(s) desde {prev_year}-{prev_month:02d}, {omitidos} omitido(s) (ya existian).",
    }


@frappe.whitelist()
def replicate_fixed_expenses(month=None, year=None):
    """Endpoint manual para replicar gastos fijos a un mes especifico.
    Si no se especifica mes/anio, usa el mes actual."""
    err = _require_admin()
    if err:
        return err
    today_d = _date.today()
    target_month = int(month) if month else today_d.month
    target_year = int(year) if year else today_d.year
    return _replicate_fixed_expenses_for(target_year, target_month)


def run_monthly_fixed_replication():
    """Tarea programada que el dia 1 de cada mes replica los gastos fijos
    del mes anterior al mes actual. Se invoca desde el cron del scheduler.
    Idempotente: si ya corrio antes para este mes, no duplica.
    """
    today_d = _date.today()
    try:
        result = _replicate_fixed_expenses_for(today_d.year, today_d.month)
        frappe.logger().info(f"[finanzas_corp] Replicacion mensual: {result.get('message')}")
    except Exception:
        frappe.log_error(frappe.get_traceback(), "CRON-REPLICATE-FIXED")

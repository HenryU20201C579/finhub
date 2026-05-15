import json

import frappe
from frappe import _
from frappe.utils import flt, get_first_day, get_last_day, nowdate


ADMIN_ROLES = ("Finhub-Finanzas-Administrar",)
VIEW_ROLES = ("Finhub-Finanzas-Ver", "Finhub-Finanzas-Administrar")

# Alias legacy para retrocompatibilidad interna del modulo
ROLE_VIEW = "Finhub-Finanzas-Ver"
ROLE_EDIT = "Finhub-Finanzas-Administrar"


CATALOG_CONFIG = {
	"Categoria Gasto Distribucion": {
		"name_field": "nombre",
		"list_fields": ["name", "activo", "descripcion"],
		"editable": ["nombre", "activo", "descripcion"],
		"in_use_check": [("Gastos de Distribucion", "categoria")]
	},
	"Metodo Pago": {
		"name_field": "nombre",
		"list_fields": ["name"],
		"editable": ["nombre"],
		"in_use_check": [
			("Gastos de Distribucion", "metodo_pago"),
			("Finanzas Corporativas", "metodo_pago")
		]
	},
	"Categoria Adjuntos Finanzas": {
		"name_field": "nombre",
		"list_fields": ["name"],
		"editable": ["nombre"],
		"in_use_check": [("Finanzas Adjuntos Asociado", "categoria")]
	}
}


def _roles():
	return set(frappe.get_roles(frappe.session.user))


def _is_admin():
	return bool(_roles().intersection(ADMIN_ROLES))


def _can_view():
	return bool(_roles().intersection(VIEW_ROLES))


# Aliases legacy internos (usados en el resto del archivo)
def _has_view():
	return _can_view()


def _has_edit():
	return _is_admin()


def _deny():
	return {"status": "error", "message": "Acceso denegado"}


def _require_view():
	if not _has_view():
		frappe.throw(
			"Acceso denegado. Requiere uno de los roles: "
			+ ", ".join(VIEW_ROLES),
			frappe.PermissionError,
		)


def _require_edit():
	if not _has_edit():
		frappe.throw(
			"Acceso denegado. Requiere el rol: "
			+ ", ".join(ADMIN_ROLES),
			frappe.PermissionError,
		)


def _require_admin():
	_require_edit()


def get_context(context):
	context.title = _("Gastos de Distribucion")
	context.no_access = not _can_view()
	context.required_roles = list(VIEW_ROLES)
	context.can_edit = _is_admin()
	context.no_header = 1
	context.no_footer = 1
	context.no_breadcrumbs = 1
	context.no_sidebar = 1


@frappe.whitelist()
def get_initial_data():
	if not _has_view():
		return _deny()

	categorias = frappe.get_all(
		"Categoria Gasto Distribucion",
		fields=["name", "activo"],
		order_by="name asc"
	)
	categorias = [c for c in categorias if c.get("activo")]

	metodos_pago = frappe.get_all("Metodo Pago", fields=["name"], order_by="name asc")
	cat_adjuntos = frappe.get_all("Categoria Adjuntos Finanzas", fields=["name"], order_by="name asc")

	return {
		"categorias": categorias,
		"metodos_pago": [m.name for m in metodos_pago],
		"categorias_adjuntos": [c.name for c in cat_adjuntos],
		"stats": get_summary_stats(),
		"can_edit": _has_edit()
	}


@frappe.whitelist()
def get_summary_stats(filters=None):
	if not _has_view():
		return _deny()

	if isinstance(filters, str):
		filters = json.loads(filters)

	today = nowdate()
	start = get_first_day(today)
	end = get_last_day(today)

	if filters:
		if filters.get("start_date"):
			start = filters["start_date"]
		if filters.get("end_date"):
			end = filters["end_date"]

	total_hoy = frappe.db.sql("""
		SELECT IFNULL(SUM(monto), 0)
		FROM `tabGastos de Distribucion`
		WHERE DATE(fecha) = %s
	""", (today,))[0][0] or 0

	total_periodo = frappe.db.sql("""
		SELECT IFNULL(SUM(monto), 0)
		FROM `tabGastos de Distribucion`
		WHERE DATE(fecha) BETWEEN %s AND %s
	""", (start, end))[0][0] or 0

	por_categoria = frappe.db.sql("""
		SELECT COALESCE(categoria, 'Sin Categoria') AS categoria,
			SUM(monto) AS total,
			COUNT(*) AS cantidad
		FROM `tabGastos de Distribucion`
		WHERE DATE(fecha) BETWEEN %s AND %s
		GROUP BY COALESCE(categoria, 'Sin Categoria')
		ORDER BY total DESC
	""", (start, end), as_dict=True)

	por_estado = frappe.db.sql("""
		SELECT estado,
			SUM(monto) AS total,
			COUNT(*) AS cantidad
		FROM `tabGastos de Distribucion`
		WHERE DATE(fecha) BETWEEN %s AND %s
		GROUP BY estado
	""", (start, end), as_dict=True)

	return {
		"total_hoy": float(total_hoy),
		"total_periodo": float(total_periodo),
		"por_categoria": [
			{"categoria": r.categoria, "total": float(r.total), "cantidad": r.cantidad}
			for r in por_categoria
		],
		"por_estado": [
			{"estado": r.estado, "total": float(r.total), "cantidad": r.cantidad}
			for r in por_estado
		]
	}


@frappe.whitelist()
def get_gastos_list(filters=None):
	if not _has_view():
		return _deny()

	if isinstance(filters, str):
		filters = json.loads(filters)

	conditions = {}
	if filters:
		if filters.get("estado"):
			conditions["estado"] = filters["estado"]
		if filters.get("categoria"):
			conditions["categoria"] = filters["categoria"]
		if filters.get("start_date") and filters.get("end_date"):
			conditions["fecha"] = ["between", [filters["start_date"], filters["end_date"]]]

	if filters and filters.get("caja_chica"):
		conditions["caja_chica"] = filters["caja_chica"]

	gastos = frappe.get_all(
		"Gastos de Distribucion",
		filters=conditions,
		fields=[
			"name", "fecha", "categoria", "monto", "metodo_pago", "estado",
			"descripcion", "empleado", "creation",
			"caja_chica", "pago_finanzas_p"
		],
		order_by="fecha desc, creation desc",
		limit=100
	)

	if not gastos:
		return []

	names = [g.name for g in gastos]
	adjuntos = frappe.get_all(
		"Finanzas Adjuntos Asociado",
		filters={"parent": ["in", names], "parenttype": "Gastos de Distribucion"},
		fields=["parent", "categoria", "archivo"]
	)

	adj_map = {}
	for adjunto in adjuntos:
		adj_map.setdefault(adjunto.parent, []).append(adjunto)

	pedidos = frappe.get_all(
		"Pedido Gasto Distribucion",
		filters={"parent": ["in", names], "parenttype": "Gastos de Distribucion"},
		fields=["parent", "pedido_tipo", "pedido", "cliente", "monto", "idx"],
		order_by="idx asc"
	)
	ped_map = {}
	for p in pedidos:
		ped_map.setdefault(p.parent, []).append({
			"pedido_tipo": p.pedido_tipo,
			"pedido": p.pedido,
			"cliente": p.cliente,
			"monto": flt(p.monto)
		})

	for gasto in gastos:
		gasto["adjuntos"] = adj_map.get(gasto.name, [])
		gasto["pedidos"] = ped_map.get(gasto.name, [])

	return gastos


@frappe.whitelist()
def get_gasto(name):
	if not _has_view():
		return _deny()

	doc = frappe.get_doc("Gastos de Distribucion", name)
	data = doc.as_dict()
	data["adjuntos"] = [
		{"categoria": a.categoria, "archivo": a.archivo} for a in doc.adjuntos
	]
	data["pedidos"] = [
		{
			"pedido_tipo": p.pedido_tipo,
			"pedido": p.pedido,
			"cliente": p.cliente,
			"monto": flt(p.monto)
		}
		for p in (doc.get("pedidos") or [])
	]
	data.pop("pagos", None)
	return data


def _apply_pedidos(doc, data):
	"""
	Rellena la child table `pedidos` a partir de data["pedidos"] = [{pedido_tipo, pedido}, ...].
	Valida existencia y tipo; cachea customer_name/grand_total en las filas.
	"""
	raw = data.get("pedidos") or []
	if not isinstance(raw, list):
		raw = []

	cleaned = []
	seen = set()
	for item in raw:
		tipo = (item.get("pedido_tipo") or "").strip()
		name = (item.get("pedido") or "").strip()
		if not tipo or not name:
			continue
		if tipo not in ("Sales Invoice", "Sales Order"):
			frappe.throw(_("Tipo de pedido no soportado: {0}").format(tipo))
		key = (tipo, name)
		if key in seen:
			continue
		seen.add(key)
		cleaned.append({"pedido_tipo": tipo, "pedido": name})

	# Bulk fetch por tipo para minimizar queries
	info = {}
	for tipo in ("Sales Invoice", "Sales Order"):
		names = [c["pedido"] for c in cleaned if c["pedido_tipo"] == tipo]
		if not names:
			continue
		rows = frappe.get_all(
			tipo,
			filters={"name": ["in", names]},
			fields=["name", "customer_name", "grand_total"]
		)
		for r in rows:
			info[(tipo, r.name)] = (r.customer_name, flt(r.grand_total))

	doc.set("pedidos", [])
	for c in cleaned:
		key = (c["pedido_tipo"], c["pedido"])
		if key not in info:
			frappe.throw(_("El pedido {0} no existe.").format(c["pedido"]))
		cliente, monto = info[key]
		doc.append("pedidos", {
			"pedido_tipo": c["pedido_tipo"],
			"pedido": c["pedido"],
			"cliente": cliente,
			"monto": monto
		})


@frappe.whitelist()
def save_gasto(data):
	_require_edit()

	if isinstance(data, str):
		data = json.loads(data)

	try:
		if data.get("name"):
			doc = frappe.get_doc("Gastos de Distribucion", data["name"])
		else:
			doc = frappe.new_doc("Gastos de Distribucion")

		doc.fecha = data.get("fecha") or nowdate()
		doc.categoria = data.get("categoria")
		doc.monto = flt(data.get("monto"))
		doc.metodo_pago = data.get("metodo_pago") or None
		doc.estado = data.get("estado") or "Pendiente"
		doc.descripcion = data.get("descripcion")
		doc.empleado = data.get("empleado") or None

		_apply_pedidos(doc, data)

		doc.set("adjuntos", [])
		for item in (data.get("adjuntos") or []):
			doc.append("adjuntos", {
				"categoria": item.get("categoria"),
				"archivo": item.get("archivo")
			})

		doc.save()
		return {"status": "success", "message": "Gasto guardado correctamente", "name": doc.name}

	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "SAVE-GASTO-DIST-ERROR")
		return {"status": "error", "message": str(e)}


def _delete_gasto_cascade(name):
	"""
	Elimina un Gasto de Distribucion aplicando cascada:
	- si tiene caja_chica Abierta + pago_finanzas_p: elimina el gasto primero (rompe link),
	  luego elimina el Pago Finanzas P y recalcula saldo.
	- si la caja esta Cerrada: rechaza.
	- si no tiene caja: borrado simple.
	El pedido vinculado (SI/SO) no se modifica.
	"""
	if not frappe.db.exists("Gastos de Distribucion", name):
		return {"status": "error", "message": "Gasto no encontrado"}

	doc = frappe.get_doc("Gastos de Distribucion", name)
	caja_name = doc.caja_chica
	pago_name = doc.pago_finanzas_p
	monto = flt(doc.monto)
	monto_liberado = 0

	if caja_name:
		estado_caja = frappe.db.get_value("Caja Chica", caja_name, "estado")
		if estado_caja == "Cerrada":
			return {
				"status": "error",
				"message": "No se puede eliminar: la caja chica asociada esta cerrada. Reabra la caja primero."
			}

	# 1. Delete gasto first so Pago Finanzas P no longer has inbound link.
	frappe.delete_doc("Gastos de Distribucion", name, ignore_permissions=True)

	# 2. Delete the linked Pago Finanzas P and recalculate caja saldo.
	if caja_name and pago_name and frappe.db.exists("Pago Finanzas P", pago_name):
		from finhub.www.caja_chica.index import delete_payment as _caja_delete_payment
		res = _caja_delete_payment(pago_name, caja_name)
		if isinstance(res, dict) and res.get("status") == "error":
			return {
				"status": "error",
				"message": f"Gasto eliminado pero no se pudo borrar el pago: {res.get('message')}"
			}
		monto_liberado = monto

	msg = "Gasto eliminado"
	if monto_liberado:
		msg += f". Se liberaron S/ {monto_liberado:.2f} del saldo de la caja {caja_name}."
	return {"status": "success", "message": msg, "liberado": monto_liberado, "caja": caja_name}


@frappe.whitelist()
def delete_gasto(name):
	_require_edit()
	try:
		return _delete_gasto_cascade(name)
	except frappe.PermissionError:
		raise
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "DELETE-GASTO-DIST-ERROR")
		return {"status": "error", "message": str(e)}


@frappe.whitelist()
def search_pedidos(tipo, q=None, limit=20):
	_require_view()

	if tipo not in ("Sales Invoice", "Sales Order"):
		return {"status": "error", "message": "Tipo de pedido no soportado"}

	try:
		limit = int(limit)
	except (TypeError, ValueError):
		limit = 20
	limit = max(1, min(limit, 50))

	q = (q or "").strip()
	filters = {"docstatus": ["<", 2]}
	or_filters = None
	if q:
		or_filters = [
			["name", "like", f"%{q}%"],
			["customer_name", "like", f"%{q}%"]
		]

	date_field = "posting_date" if tipo == "Sales Invoice" else "transaction_date"

	if tipo == "Sales Order":
		base_fields = [
			"name",
			"customer_name",
			"grand_total",
			f"{date_field} as fecha",
			"status",
			"custom_courier",
			"custom_tienda",
			"custom_direccion",
			"custom_fecha_envio"
		]
	else:
		base_fields = [
			"name",
			"customer_name",
			"grand_total",
			f"{date_field} as fecha",
			"status"
		]

	rows = frappe.get_all(
		tipo,
		filters=filters,
		or_filters=or_filters,
		fields=base_fields,
		order_by=f"{date_field} desc, name desc",
		limit=limit
	)

	if not rows:
		return {"status": "success", "rows": []}

	# Para Sales Invoice: enriquecer desde Sales Order vinculada
	if tipo == "Sales Invoice":
		inv_names = [r.name for r in rows]
		items = frappe.get_all(
			"Sales Invoice Item",
			filters={"parent": ["in", inv_names]},
			fields=["parent", "sales_order"],
			order_by="idx asc"
		)
		# Primer item por parent
		inv_to_so = {}
		for it in items:
			if it.sales_order and it.parent not in inv_to_so:
				inv_to_so[it.parent] = it.sales_order

		so_names = list(set(inv_to_so.values()))
		so_map = {}
		if so_names:
			so_rows = frappe.get_all(
				"Sales Order",
				filters={"name": ["in", so_names]},
				fields=["name", "custom_courier", "custom_tienda", "custom_direccion", "custom_fecha_envio"]
			)
			so_map = {s.name: s for s in so_rows}

		for r in rows:
			so_name = inv_to_so.get(r.name)
			r["linked_sales_order"] = so_name
			so = so_map.get(so_name) if so_name else None
			r["custom_courier"] = (so or {}).get("custom_courier") if so else None
			r["custom_tienda"] = (so or {}).get("custom_tienda") if so else None
			r["custom_direccion"] = (so or {}).get("custom_direccion") if so else None
			r["custom_fecha_envio"] = (so or {}).get("custom_fecha_envio") if so else None

	# Resolver telefono + texto direccion desde Direccion (bulk)
	dir_names = list(set([r.get("custom_direccion") for r in rows if r.get("custom_direccion")]))
	phone_map = {}
	dir_text_map = {}
	if dir_names:
		dir_rows = frappe.get_all(
			"Direccion",
			filters={"name": ["in", dir_names]},
			fields=["name", "telefono", "direccion_1", "direccion_2", "ciudad", "provincia"]
		)
		for d in dir_rows:
			phone_map[d.name] = d.telefono
			parts = [p for p in [d.direccion_1, d.direccion_2, d.ciudad, d.provincia] if p]
			dir_text_map[d.name] = ", ".join(parts) if parts else None

	for r in rows:
		dn = r.get("custom_direccion")
		r["direccion_telefono"] = phone_map.get(dn) or None
		r["direccion_texto"] = dir_text_map.get(dn) or None

	return {"status": "success", "rows": rows}


@frappe.whitelist()
def list_catalog(doctype):
	_require_view()
	if doctype not in CATALOG_CONFIG:
		return {"status": "error", "message": "Catalogo no permitido"}

	cfg = CATALOG_CONFIG[doctype]
	rows = frappe.get_all(doctype, fields=cfg["list_fields"], order_by="name asc")
	return {"status": "success", "rows": rows}


@frappe.whitelist()
def save_catalog(doctype, data):
	_require_edit()
	if doctype not in CATALOG_CONFIG:
		return {"status": "error", "message": "Catalogo no permitido"}

	cfg = CATALOG_CONFIG[doctype]

	if isinstance(data, str):
		data = json.loads(data)

	name_field = cfg["name_field"]
	nuevo_nombre = (data.get(name_field) or "").strip()
	if not nuevo_nombre:
		return {"status": "error", "message": f"El campo {name_field} es requerido"}

	try:
		current_name = data.get("name")

		if current_name:
			if current_name != nuevo_nombre:
				if frappe.db.exists(doctype, nuevo_nombre):
					return {"status": "error", "message": f"Ya existe un registro con nombre '{nuevo_nombre}'"}
				frappe.rename_doc(doctype, current_name, nuevo_nombre, force=True)
				current_name = nuevo_nombre

			doc = frappe.get_doc(doctype, current_name)
			for field in cfg["editable"]:
				if field == name_field:
					continue
				if field in data:
					setattr(doc, field, data.get(field))
			doc.flags.ignore_permissions = True
			doc.save(ignore_permissions=True)
			return {"status": "success", "name": doc.name, "created": False}

		if frappe.db.exists(doctype, nuevo_nombre):
			return {"status": "error", "message": f"Ya existe un registro con nombre '{nuevo_nombre}'"}
		doc = frappe.new_doc(doctype)
		for field in cfg["editable"]:
			if field in data:
				setattr(doc, field, data.get(field))
		doc.flags.ignore_permissions = True
		doc.insert(ignore_permissions=True)
		return {"status": "success", "name": doc.name, "created": True}

	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "SAVE-CATALOG-ERROR")
		return {"status": "error", "message": str(e)}


@frappe.whitelist()
def delete_catalog(doctype, name):
	_require_edit()
	if doctype not in CATALOG_CONFIG:
		return {"status": "error", "message": "Catalogo no permitido"}

	cfg = CATALOG_CONFIG[doctype]

	desglose = []
	total_uso = 0
	for target_doctype, field in cfg["in_use_check"]:
		try:
			count = frappe.db.count(target_doctype, {field: name})
			if count:
				desglose.append({"doctype": target_doctype, "field": field, "count": count})
				total_uso += count
		except Exception:
			pass

	if total_uso:
		return {
			"status": "error",
			"message": f"No se puede eliminar: este registro esta siendo usado en {total_uso} lugar(es).",
			"in_use": desglose
		}

	try:
		frappe.delete_doc(doctype, name, ignore_permissions=True)
		return {"status": "success", "message": "Registro eliminado"}
	except Exception as e:
		frappe.log_error(frappe.get_traceback(), "DELETE-CATALOG-ERROR")
		return {"status": "error", "message": str(e)}

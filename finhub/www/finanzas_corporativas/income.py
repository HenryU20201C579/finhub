import frappe
from frappe.utils import get_first_day, get_last_day, getdate
from finhub.www.finanzas_corporativas.index import _require_view, _require_admin

@frappe.whitelist()
def get_monthly_income(month_year_date):
    """
    Retrieves or establishes the starting Total Income for a given month.
    month_year_date corresponds to the 1st of the month (e.g. '2026-02-01').
    Uses a simple Single-like structure referencing the month.
    """
    err = _require_view()
    if err: return err
        
    # We will use the 'Singles' approach loosely by saving values in a Custom Doctype 
    # OR we can just use frappe.db.set_value / configuration if we create a quick helper DocType.
    # To avoid relying on a new Doctype right now, we can use frappe's `Property Setter` or `Singles` table 
    # indirectly, or simple generic `TabSettings` but the easiest bulletproof way without schema changes is configuring a 'Custom DocType' on the fly or using `Note`.
    
    # We'll use a Note for holding this temporary state per month to avoid schema creation scripts
    note_title = f"Ingreso_Finanzas_{month_year_date[:7]}"
    
    note_name = frappe.db.get_value("Note", {"title": note_title}, "name")
    if note_name:
        content = frappe.db.get_value("Note", note_name, "content")
        try:
            val = float(content)
            return {"status": "success", "amount": val}
        except:
            return {"status": "success", "amount": 0.0}
    else:
        return {"status": "success", "amount": 0.0}

@frappe.whitelist()
def save_monthly_income(month_year_date, amount):
    err = _require_admin()
    if err: return err
        
    note_title = f"Ingreso_Finanzas_{month_year_date[:7]}"
    note_name = frappe.db.get_value("Note", {"title": note_title}, "name")
    
    if note_name:
        frappe.db.set_value("Note", note_name, "content", str(amount))
    else:
        doc = frappe.new_doc("Note")
        doc.title = note_title
        doc.content = str(amount)
        doc.public = 0
        doc.insert(ignore_permissions=True)
        
    return {"status": "success", "amount": amount}

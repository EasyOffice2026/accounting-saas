from fastapi import APIRouter, Depends, Form, HTTPException
from sqlalchemy.orm import Session
from datetime import date, timedelta
from typing import Optional
import httpx

from app.database import get_db
from app.models.whatsapp import WhatsAppSettings
from app.models.sale import Sale
from app.models.branch import Branch
from app.models.user import User
from app.models.purchase import PurchaseOrder, PurchaseItem, Supplier
from app.models.expense import Expense, ExpenseCategory
from app.utils.auth import get_current_user

router = APIRouter(prefix="/api/whatsapp", tags=["whatsapp"])


@router.get("/settings")
def get_settings(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role not in ("owner", "manager"):
        raise HTTPException(403, "Not authorized")
    s = db.query(WhatsAppSettings).first()
    if not s:
        return {"provider": "greenapi", "instance_id": "", "default_phone": "", "has_token": False,
                "sales_group": "", "purchases_group": "", "expenses_group": "", "hr_group": "", "transfers_group": ""}
    return {
        "provider": s.provider or "greenapi",
        "instance_id": s.instance_id or "",
        "api_url": s.api_url or "",
        "default_phone": s.default_phone or "",
        "has_token": bool(s.api_token),
        "sales_group": s.sales_group or "",
        "purchases_group": s.purchases_group or "",
        "expenses_group": s.expenses_group or "",
        "hr_group": s.hr_group or "",
        "transfers_group": s.transfers_group or "",
    }


@router.post("/settings")
def save_settings(
    instance_id: str = Form(""),
    api_token: str = Form(""),
    api_url: str = Form(""),
    default_phone: str = Form(""),
    sales_group: str = Form(""),
    purchases_group: str = Form(""),
    expenses_group: str = Form(""),
    hr_group: str = Form(""),
    transfers_group: str = Form(""),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ("owner", "manager"):
        raise HTTPException(403, "Not authorized")
    s = db.query(WhatsAppSettings).first()
    if not s:
        s = WhatsAppSettings(provider="greenapi")
        db.add(s)
    if instance_id:
        s.instance_id = instance_id
    if api_token:
        s.api_token = api_token
    if api_url:
        s.api_url = api_url
    if default_phone:
        s.default_phone = default_phone
    s.sales_group = sales_group or None
    s.purchases_group = purchases_group or None
    s.expenses_group = expenses_group or None
    s.hr_group = hr_group or None
    s.transfers_group = transfers_group or None
    db.commit()
    return {"message": "WhatsApp settings saved"}


def _build_daily_sales_report(db: Session, report_date: date) -> str:
    """Build a formatted daily sales report for all branches."""
    branches = db.query(Branch).filter(Branch.is_central_kitchen == False).all()
    sales = db.query(Sale).filter(Sale.date == report_date).all()
    sales_by_branch = {}
    for s in sales:
        sales_by_branch[s.branch_id] = s

    lines = []
    lines.append(f"📊 *Mudawwarah Daily Sales Report*")
    lines.append(f"📅 Date: {report_date.strftime('%d/%m/%Y')}")
    lines.append("")

    grand_foodics = 0
    grand_physical = 0

    for br in branches:
        sale = sales_by_branch.get(br.id)
        if sale:
            f_cash = sale.foodics_cash or 0
            f_knet = sale.foodics_knet or 0
            f_link = sale.foodics_link or 0
            f_wamd = sale.foodics_wamd or 0
            foodics_total = f_cash + f_knet + f_link + f_wamd

            p_cash = sale.physical_cash or 0
            p_knet = sale.physical_knet or 0
            p_link = sale.physical_link or 0
            p_wamd = sale.physical_wamd or 0
            physical_total = p_cash + p_knet + p_link + p_wamd

            diff = physical_total - foodics_total
            grand_foodics += foodics_total
            grand_physical += physical_total

            lines.append(f"🏪 *{br.name}*")
            lines.append(f"  Foodics: KD {foodics_total:,.3f}")
            lines.append(f"    Cash: {f_cash:,.3f} | KNET: {f_knet:,.3f} | Link: {f_link:,.3f} | WAMD: {f_wamd:,.3f}")
            lines.append(f"  Physical: KD {physical_total:,.3f}")
            lines.append(f"    Cash: {p_cash:,.3f} | KNET: {p_knet:,.3f} | Link: {p_link:,.3f} | WAMD: {p_wamd:,.3f}")
            diff_sign = "+" if diff >= 0 else ""
            lines.append(f"  Difference: {diff_sign}{diff:,.3f}")
        else:
            lines.append(f"🏪 *{br.name}*")
            lines.append(f"  ⚠️ No sales data entered")
        lines.append("")

    grand_diff = grand_physical - grand_foodics
    diff_sign = "+" if grand_diff >= 0 else ""
    lines.append("━━━━━━━━━━━━━━━━━")
    lines.append(f"*TOTAL (All Branches)*")
    lines.append(f"  Foodics: KD {grand_foodics:,.3f}")
    lines.append(f"  Physical: KD {grand_physical:,.3f}")
    lines.append(f"  Difference: {diff_sign}{grand_diff:,.3f}")

    return "\n".join(lines)


def _send_whatsapp_message(instance_id: str, api_token: str, phone: str, message: str, api_url: str = "") -> dict:
    """Send a WhatsApp message via Green API. Supports both phone numbers and group IDs."""
    base = api_url.rstrip("/") if api_url else "https://api.green-api.com"
    url = f"{base}/waInstance{instance_id}/sendMessage/{api_token}"
    phone = phone.strip()
    # If it's a group ID (contains @g.us), use as-is
    if "@g.us" in phone:
        chat_id = phone
    else:
        # Ensure phone has country code, default to Kuwait (+965)
        phone = phone.replace("+", "").replace(" ", "").replace("-", "")
        if len(phone) == 8:
            phone = "965" + phone
        chat_id = f"{phone}@c.us"
    payload = {
        "chatId": chat_id,
        "message": message,
    }
    resp = httpx.post(url, json=payload, timeout=30)
    return resp.json()


def _send_to_group_if_configured(db: Session, group_field: str, message: str):
    """Send a message to a configured WhatsApp group (global setting). Returns True if sent."""
    settings = db.query(WhatsAppSettings).first()
    if not settings or not settings.instance_id or not settings.api_token:
        return False
    group_id = getattr(settings, group_field, None)
    if not group_id:
        return False
    try:
        _send_whatsapp_message(settings.instance_id, settings.api_token, group_id, message, settings.api_url or "")
        return True
    except Exception:
        return False


def _send_to_entity_group(db: Session, group_id: str, message: str):
    """Send a message to a specific entity's WhatsApp group (branch or supplier). Returns True if sent."""
    settings = db.query(WhatsAppSettings).first()
    if not settings or not settings.instance_id or not settings.api_token:
        return False
    if not group_id:
        return False
    try:
        _send_whatsapp_message(settings.instance_id, settings.api_token, group_id, message, settings.api_url or "")
        return True
    except Exception:
        return False


@router.get("/groups")
def list_whatsapp_groups(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Fetch list of WhatsApp groups from Green API instance."""
    if user.role not in ("owner", "manager"):
        raise HTTPException(403, "Not authorized")
    settings = db.query(WhatsAppSettings).first()
    if not settings or not settings.instance_id or not settings.api_token:
        raise HTTPException(400, "WhatsApp not configured")
    base = (settings.api_url or "https://api.green-api.com").rstrip("/")
    url = f"{base}/waInstance{settings.instance_id}/getContacts/{settings.api_token}"
    try:
        resp = httpx.get(url, timeout=30)
        contacts = resp.json()
        groups = [{"id": c.get("id", ""), "name": c.get("name", "")}
                  for c in contacts if isinstance(c, dict) and str(c.get("id", "")).endswith("@g.us")]
        return groups
    except Exception as e:
        raise HTTPException(500, f"Failed to fetch groups: {str(e)}")


@router.post("/send-daily-report")
def send_daily_report(
    report_date: Optional[str] = Form(None),
    phone: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ("owner", "manager"):
        raise HTTPException(403, "Not authorized")

    settings = db.query(WhatsAppSettings).first()
    if not settings or not settings.instance_id or not settings.api_token:
        raise HTTPException(400, "WhatsApp not configured. Go to Settings to set up Green API credentials.")

    target_date = date.fromisoformat(report_date) if report_date else date.today()
    target_phone = phone or settings.default_phone
    if not target_phone:
        raise HTTPException(400, "No phone number provided")

    report = _build_daily_sales_report(db, target_date)
    result = _send_whatsapp_message(settings.instance_id, settings.api_token, target_phone, report, settings.api_url or "")

    if "idMessage" in result:
        return {"message": "Report sent successfully", "id": result["idMessage"]}
    else:
        raise HTTPException(500, f"Failed to send: {result}")


@router.get("/preview-report")
def preview_report(
    report_date: Optional[str] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    target_date = date.fromisoformat(report_date) if report_date else date.today()
    report = _build_daily_sales_report(db, target_date)
    return {"report": report, "date": str(target_date)}


@router.post("/send-purchase")
def send_purchase_whatsapp(
    order_id: int = Form(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Send purchase order details to the supplier's WhatsApp number."""
    settings = db.query(WhatsAppSettings).first()
    if not settings or not settings.instance_id or not settings.api_token:
        raise HTTPException(400, "WhatsApp not configured. Go to Settings to set up Green API credentials.")

    order = db.query(PurchaseOrder).filter(PurchaseOrder.id == order_id).first()
    if not order:
        raise HTTPException(404, "Order not found")

    supplier = db.query(Supplier).filter(Supplier.id == order.supplier_id).first()
    if not supplier or not supplier.whatsapp:
        raise HTTPException(400, "Supplier has no WhatsApp number configured")

    items = db.query(PurchaseItem).filter(PurchaseItem.purchase_order_id == order.id).all()
    branch = db.query(Branch).filter(Branch.id == order.branch_id).first()

    lines = []
    lines.append("📋 *Purchase Order*")
    lines.append(f"📅 Date: {order.date}")
    lines.append(f"🏪 Branch: {branch.name if branch else ''}")
    lines.append(f"🏢 Supplier: {supplier.name}")
    lines.append(f"💳 Payment: {order.payment_type}")
    lines.append("")
    lines.append("*Items:*")
    for it in items:
        lines.append(f"  • {it.item_name} — {it.quantity} {it.unit} × {it.unit_price:.3f} = KD {it.total:.3f}")
    lines.append("")
    lines.append(f"*Total: KD {order.total_amount:.3f}*")
    if order.notes:
        lines.append(f"📝 Notes: {order.notes}")

    msg = "\n".join(lines)
    result = _send_whatsapp_message(settings.instance_id, settings.api_token, supplier.whatsapp, msg, settings.api_url or "")

    if "idMessage" in result:
        return {"message": "Purchase order sent to supplier", "id": result["idMessage"]}
    else:
        raise HTTPException(500, f"Failed to send: {result}")


@router.post("/send-expense")
def send_expense_whatsapp(
    expense_id: int = Form(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Send expense details to the supplier's WhatsApp number."""
    settings = db.query(WhatsAppSettings).first()
    if not settings or not settings.instance_id or not settings.api_token:
        raise HTTPException(400, "WhatsApp not configured. Go to Settings to set up Green API credentials.")

    expense = db.query(Expense).filter(Expense.id == expense_id).first()
    if not expense:
        raise HTTPException(404, "Expense not found")

    supplier = db.query(Supplier).filter(Supplier.id == expense.supplier_id).first() if expense.supplier_id else None
    if not supplier or not supplier.whatsapp:
        raise HTTPException(400, "Supplier has no WhatsApp number configured")

    branch = db.query(Branch).filter(Branch.id == expense.branch_id).first()
    category = db.query(ExpenseCategory).filter(ExpenseCategory.id == expense.category_id).first() if expense.category_id else None

    lines = []
    lines.append("💰 *Expense Receipt*")
    lines.append(f"📅 Date: {expense.date}")
    lines.append(f"🏪 Branch: {branch.name if branch else ''}")
    lines.append(f"🏢 Supplier: {supplier.name}")
    if category:
        lines.append(f"📁 Category: {category.name}")
    lines.append(f"📝 Description: {expense.description}")
    lines.append(f"💳 Payment: {expense.payment_method}")
    lines.append(f"*Amount: KD {expense.amount:.3f}*")
    if expense.notes:
        lines.append(f"📝 Notes: {expense.notes}")

    msg = "\n".join(lines)
    result = _send_whatsapp_message(settings.instance_id, settings.api_token, supplier.whatsapp, msg, settings.api_url or "")

    if "idMessage" in result:
        return {"message": "Expense sent to supplier", "id": result["idMessage"]}
    else:
        raise HTTPException(500, f"Failed to send: {result}")


@router.post("/send-sales")
def send_sales_whatsapp(
    branch_id: int = Form(...),
    report_date: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Send sales report to the branch's configured WhatsApp number."""
    settings = db.query(WhatsAppSettings).first()
    if not settings or not settings.instance_id or not settings.api_token:
        raise HTTPException(400, "WhatsApp not configured. Go to Settings to set up Green API credentials.")

    branch = db.query(Branch).filter(Branch.id == branch_id).first()
    if not branch or not branch.whatsapp_number:
        raise HTTPException(400, "Branch has no WhatsApp number configured")

    target_date = date.fromisoformat(report_date) if report_date else date.today()
    sale = db.query(Sale).filter(Sale.branch_id == branch_id, Sale.date == target_date).first()

    lines = []
    lines.append(f"📊 *Sales Report — {branch.name}*")
    lines.append(f"📅 Date: {target_date.strftime('%d/%m/%Y')}")
    lines.append("")

    if sale:
        f_cash = sale.foodics_cash or 0
        f_knet = sale.foodics_knet or 0
        f_link = sale.foodics_link or 0
        f_wamd = sale.foodics_wamd or 0
        f_snoonu = getattr(sale, "foodics_snoonu", 0) or 0
        foodics_total = f_cash + f_knet + f_link + f_wamd + f_snoonu

        p_cash = sale.physical_cash or 0
        p_knet = sale.physical_knet or 0
        p_link = sale.physical_link or 0
        p_wamd = sale.physical_wamd or 0
        p_snoonu = getattr(sale, "physical_snoonu", 0) or 0
        physical_total = p_cash + p_knet + p_link + p_wamd + p_snoonu

        lines.append("*POS Data:*")
        lines.append(f"  Cash: {f_cash:,.3f} | KNET: {f_knet:,.3f} | Link: {f_link:,.3f} | WAMD: {f_wamd:,.3f} | Snoonu: {f_snoonu:,.3f}")
        lines.append(f"  *Total: KD {foodics_total:,.3f}*")
        lines.append("")
        lines.append("*Physical Data:*")
        lines.append(f"  Cash: {p_cash:,.3f} | KNET: {p_knet:,.3f} | Link: {p_link:,.3f} | WAMD: {p_wamd:,.3f} | Snoonu: {p_snoonu:,.3f}")
        lines.append(f"  *Total: KD {physical_total:,.3f}*")
        lines.append("")
        diff = physical_total - foodics_total
        diff_sign = "+" if diff >= 0 else ""
        lines.append(f"Difference: {diff_sign}{diff:,.3f}")
    else:
        lines.append("⚠️ No sales data entered for this date")

    msg = "\n".join(lines)
    result = _send_whatsapp_message(settings.instance_id, settings.api_token, branch.whatsapp_number, msg, settings.api_url or "")

    if "idMessage" in result:
        return {"message": "Sales report sent to branch", "id": result["idMessage"]}
    else:
        raise HTTPException(500, f"Failed to send: {result}")

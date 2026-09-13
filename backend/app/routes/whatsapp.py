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
    if user.role not in ("owner", "manager", "accountant"):
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
    provider: str = Form(""),
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
    if user.role not in ("owner", "manager", "accountant"):
        raise HTTPException(403, "Not authorized")
    s = db.query(WhatsAppSettings).first()
    if not s:
        s = WhatsAppSettings(provider="greenapi")
        db.add(s)
    if provider:
        s.provider = provider
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
    grand_cancelled = 0

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

            c_cash = sale.cancelled_cash or 0
            c_knet = sale.cancelled_knet or 0
            c_link = sale.cancelled_link or 0
            cancelled_total = c_cash + c_knet + c_link

            diff = physical_total - (foodics_total - cancelled_total)
            grand_foodics += foodics_total
            grand_physical += physical_total
            grand_cancelled += cancelled_total

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

    grand_diff = grand_physical - (grand_foodics - grand_cancelled)
    diff_sign = "+" if grand_diff >= 0 else ""
    lines.append("━━━━━━━━━━━━━━━━━")
    lines.append(f"*TOTAL (All Branches)*")
    lines.append(f"  Foodics: KD {grand_foodics:,.3f}")
    lines.append(f"  Physical: KD {grand_physical:,.3f}")
    lines.append(f"  Difference: {diff_sign}{grand_diff:,.3f}")

    return "\n".join(lines)


def _is_configured(settings) -> bool:
    """Whether the WhatsApp provider has the minimum credentials to send."""
    if not settings:
        return False
    if (settings.provider or "greenapi").lower() == "waha":
        return bool(settings.api_url)
    return bool(settings.instance_id and settings.api_token)


def _chat_id(phone: str) -> str:
    """Normalize a phone/group into a WhatsApp chat id (@c.us / @g.us)."""
    phone = phone.strip()
    if "@g.us" in phone or "@c.us" in phone:
        return phone
    phone = phone.replace("+", "").replace(" ", "").replace("-", "")
    if len(phone) == 8:  # Kuwait local number
        phone = "965" + phone
    return f"{phone}@c.us"


def _send_whatsapp_message(settings, phone: str, message: str) -> dict:
    """Send a WhatsApp message via the configured provider (Green API or WAHA).
    Supports both phone numbers and group IDs. Returns a dict containing
    'idMessage' on success (normalized across providers)."""
    provider = (settings.provider or "greenapi").lower()
    chat_id = _chat_id(phone)

    if provider == "waha":
        base = (settings.api_url or "http://localhost:3000").rstrip("/")
        session = settings.instance_id or "default"
        headers = {"X-Api-Key": settings.api_token} if settings.api_token else {}
        payload = {"session": session, "chatId": chat_id, "text": message}
        resp = httpx.post(f"{base}/api/sendText", json=payload, headers=headers, timeout=30)
        try:
            data = resp.json()
        except Exception:
            data = {}
        if resp.status_code in (200, 201):
            mid = ""
            if isinstance(data, dict):
                # WEBJS returns {"id": ...}; NOWEB returns {"key": {"id": ...}}
                raw_id = data.get("id")
                if not raw_id and isinstance(data.get("key"), dict):
                    raw_id = data["key"].get("id")
                if isinstance(raw_id, dict):
                    mid = raw_id.get("_serialized") or raw_id.get("id") or ""
                elif raw_id:
                    mid = str(raw_id)
            return {"idMessage": mid or "sent", "raw": data}
        return {"error": data or resp.text}

    # Green API (default)
    base = settings.api_url.rstrip("/") if settings.api_url else "https://api.green-api.com"
    url = f"{base}/waInstance{settings.instance_id}/sendMessage/{settings.api_token}"
    payload = {"chatId": chat_id, "message": message}
    resp = httpx.post(url, json=payload, timeout=30)
    return resp.json()


def _send_to_group_if_configured(db: Session, group_field: str, message: str):
    """Send a message to a configured WhatsApp group (global setting). Returns True if sent."""
    settings = db.query(WhatsAppSettings).first()
    if not _is_configured(settings):
        return False
    group_id = getattr(settings, group_field, None)
    if not group_id:
        return False
    try:
        _send_whatsapp_message(settings, group_id, message)
        return True
    except Exception:
        return False


SALES_CHANNELS = [
    ("cash", "Cash", "نقد"),
    ("knet", "KNET", "كي نت"),
    ("link", "Link", "رابط"),
    ("talabat", "Talabat", "طلبات"),
    ("keeta", "Keeta", "كيتا"),
    ("jahez", "Jahez", "جاهز"),
    ("snoonu", "Snoonu", "سنونو"),
]


def _fmt_row(cells, widths):
    return " ".join(str(c).rjust(w) for c, w in zip(cells, widths))


def build_sales_message(sale: Optional[Sale], branch: Branch, target_date: date, lang: str = "en") -> str:
    """Build a bilingual sales report table: channel | POS | Physical | Cancelled | Final."""
    ar = lang == "ar"
    br_name = (getattr(branch, "name_ar", None) or branch.name) if ar else branch.name
    head_lines = []
    if ar:
        head_lines.append(f"تقرير مبيعات - {br_name}")
        head_lines.append(f"التاريخ : {target_date.strftime('%d/%m/%Y')}")
    else:
        head_lines.append(f"Sales Report - {br_name}")
        head_lines.append(f"Date : {target_date.strftime('%d/%m/%Y')}")

    if not sale:
        head_lines.append("")
        head_lines.append("لا توجد بيانات مبيعات لهذا التاريخ" if ar else "No sales data entered for this date")
        return "\n".join(head_lines)

    if ar:
        cols = ["طريق", "سيستم", "الفعلي"]
        total_label = "الإجمالي"
        diff_label = "الفرق"
    else:
        cols = ["Channel", "POS", "Physical"]
        total_label = "Total"
        diff_label = "Difference"

    rows = []
    t_pos = t_phys = t_canc = 0.0
    for key, en_label, ar_label in SALES_CHANNELS:
        pos = getattr(sale, f"foodics_{key}", 0) or 0
        phys = getattr(sale, f"physical_{key}", 0) or 0
        canc = getattr(sale, f"cancelled_{key}", 0) or 0
        t_pos += pos; t_phys += phys; t_canc += canc
        label = ar_label if ar else en_label
        rows.append([label, f"{pos:.3f}", f"{phys:.3f}"])
    diff = t_phys - (t_pos - t_canc)
    rows.append([total_label, f"{t_pos:.3f}", f"{t_phys:.3f}"])
    rows.append([diff_label, f"{diff:.3f}", ""])

    # Column widths for monospace alignment
    widths = [max(len(cols[i]), max(len(r[i]) for r in rows)) for i in range(3)]
    sep = "-" * (sum(widths) + len(widths) - 1)

    table = [_fmt_row(cols, widths), sep]
    for r in rows[:-2]:
        table.append(_fmt_row(r, widths))
    table.append(sep)
    table.append(_fmt_row(rows[-2], widths))
    table.append(_fmt_row(rows[-1], widths))

    return "\n".join(head_lines) + "\n\n```\n" + "\n".join(table) + "\n```"


def _payment_label(payment_type: str, ar: bool) -> str:
    pt = (payment_type or "").lower()
    if ar:
        return {"cash": "نقدي", "credit": "آجل"}.get(pt, payment_type or "")
    return (payment_type or "").capitalize()


def build_purchase_message(order, supplier, branch, items, lang: str = "en") -> str:
    """Build a bilingual purchase order WhatsApp message. items: list of dicts or PurchaseItem objs."""
    ar = lang == "ar"
    sup_name = (getattr(supplier, "name_ar", None) or supplier.name) if (ar and supplier) else (supplier.name if supplier else "")
    br_name = (getattr(branch, "name_ar", None) or branch.name) if (ar and branch) else (branch.name if branch else "")
    unit_cur = "د.ك" if ar else "KD"

    def _get(it, key):
        return it.get(key) if isinstance(it, dict) else getattr(it, key)

    lines = []
    if ar:
        lines.append(f"\U0001f4cb *طلب شراء رقم {order.id}*")
        lines.append(f"\U0001f4c5 التاريخ: {order.date}")
        lines.append(f"\U0001f3ea الفرع: {br_name}")
        lines.append(f"\U0001f3e2 المورد: {sup_name}")
        lines.append(f"\U0001f4b3 الدفع: {_payment_label(order.payment_type, True)}")
        lines.append("")
        lines.append("*الأصناف:*")
    else:
        lines.append(f"\U0001f4cb *Purchase Order #{order.id}*")
        lines.append(f"\U0001f4c5 Date: {order.date}")
        lines.append(f"\U0001f3ea Branch: {br_name}")
        lines.append(f"\U0001f3e2 Supplier: {sup_name}")
        lines.append(f"\U0001f4b3 Payment: {_payment_label(order.payment_type, False)}")
        lines.append("")
        lines.append("*Items:*")

    for it in items:
        name = _get(it, "item_name")
        qty = float(_get(it, "quantity"))
        unit = _get(it, "unit") or "pcs"
        price = float(_get(it, "unit_price"))
        tot = float(_get(it, "total"))
        lines.append(f"  \u2022 {name} \u2014 {qty:g} {unit} \u00d7 {price:.3f} = {unit_cur} {tot:.3f}")

    lines.append("")
    total = getattr(order, "total_amount", 0) or 0
    if ar:
        lines.append(f"*الإجمالي: {unit_cur} {total:.3f}*")
        if getattr(order, "notes", None):
            lines.append(f"\U0001f4dd ملاحظات: {order.notes}")
    else:
        lines.append(f"*Total: {unit_cur} {total:.3f}*")
        if getattr(order, "notes", None):
            lines.append(f"\U0001f4dd Notes: {order.notes}")
    return "\n".join(lines)


def _send_to_entity_group(db: Session, group_id: str, message: str):
    """Send a message to a specific entity's WhatsApp group (branch or supplier). Returns True if sent."""
    settings = db.query(WhatsAppSettings).first()
    if not _is_configured(settings):
        return False
    if not group_id:
        return False
    try:
        _send_whatsapp_message(settings, group_id, message)
        return True
    except Exception:
        return False


@router.get("/groups")
def list_whatsapp_groups(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Fetch list of WhatsApp groups from Green API instance."""
    if user.role not in ("owner", "manager", "accountant"):
        raise HTTPException(403, "Not authorized")
    settings = db.query(WhatsAppSettings).first()
    if not _is_configured(settings):
        raise HTTPException(400, "WhatsApp not configured")
    groups = []

    if (settings.provider or "greenapi").lower() == "waha":
        base = (settings.api_url or "http://localhost:3000").rstrip("/")
        session = settings.instance_id or "default"
        headers = {"X-Api-Key": settings.api_token} if settings.api_token else {}
        try:
            resp = httpx.get(f"{base}/api/{session}/groups", headers=headers, timeout=30)
            if resp.status_code == 200:
                data = resp.json()
                if isinstance(data, list):
                    for c in data:
                        if not isinstance(c, dict):
                            continue
                        gid = c.get("id")
                        if isinstance(gid, dict):
                            gid = gid.get("_serialized", "")
                        gid = str(gid or "")
                        if gid.endswith("@g.us"):
                            name = c.get("name") or (c.get("groupMetadata", {}) or {}).get("subject", "") or gid
                            groups.append({"id": gid, "name": name})
        except Exception:
            pass
        return groups

    base = (settings.api_url or "https://api.green-api.com").rstrip("/")
    inst = settings.instance_id
    token = settings.api_token
    # Try getChats first (returns groups with @g.us ids)
    try:
        url = f"{base}/waInstance{inst}/getChats/{token}"
        resp = httpx.get(url, timeout=30)
        if resp.status_code == 200:
            chats = resp.json()
            if isinstance(chats, list):
                groups = [{"id": c.get("id", ""), "name": c.get("name", "") or c.get("id", "")}
                          for c in chats if isinstance(c, dict) and str(c.get("id", "")).endswith("@g.us")]
    except Exception:
        pass
    # Fallback to getContacts if getChats returned nothing
    if not groups:
        try:
            url = f"{base}/waInstance{inst}/getContacts/{token}"
            resp = httpx.get(url, timeout=30)
            if resp.status_code == 200:
                contacts = resp.json()
                if isinstance(contacts, list):
                    groups = [{"id": c.get("id", ""), "name": c.get("name", "") or c.get("id", "")}
                              for c in contacts if isinstance(c, dict) and str(c.get("id", "")).endswith("@g.us")]
        except Exception:
            pass
    return groups


@router.post("/send-daily-report")
def send_daily_report(
    report_date: Optional[str] = Form(None),
    phone: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ("owner", "manager", "accountant"):
        raise HTTPException(403, "Not authorized")

    settings = db.query(WhatsAppSettings).first()
    if not _is_configured(settings):
        raise HTTPException(400, "WhatsApp not configured. Go to Settings to set up your provider credentials.")

    target_date = date.fromisoformat(report_date) if report_date else date.today()
    target_phone = phone or settings.default_phone
    if not target_phone:
        raise HTTPException(400, "No phone number provided")

    report = _build_daily_sales_report(db, target_date)
    result = _send_whatsapp_message(settings, target_phone, report)

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
    lang: str = Form("en"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Send purchase order details to the supplier's WhatsApp group (fallback to number)."""
    settings = db.query(WhatsAppSettings).first()
    if not _is_configured(settings):
        raise HTTPException(400, "WhatsApp not configured. Go to Settings to set up your provider credentials.")

    order = db.query(PurchaseOrder).filter(PurchaseOrder.id == order_id).first()
    if not order:
        raise HTTPException(404, "Order not found")

    supplier = db.query(Supplier).filter(Supplier.id == order.supplier_id).first()
    target = (getattr(supplier, "whatsapp_group", None) or supplier.whatsapp) if supplier else None
    if not target:
        raise HTTPException(400, "Supplier has no WhatsApp group or number configured")

    items = db.query(PurchaseItem).filter(PurchaseItem.purchase_order_id == order.id).all()
    branch = db.query(Branch).filter(Branch.id == order.branch_id).first()

    msg = build_purchase_message(order, supplier, branch, items, lang)
    result = _send_whatsapp_message(settings, target, msg)

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
    if not _is_configured(settings):
        raise HTTPException(400, "WhatsApp not configured. Go to Settings to set up your provider credentials.")

    expense = db.query(Expense).filter(Expense.id == expense_id).first()
    if not expense:
        raise HTTPException(404, "Expense not found")

    supplier = db.query(Supplier).filter(Supplier.id == expense.supplier_id).first() if expense.supplier_id else None
    target = (getattr(supplier, "whatsapp_group", None) or supplier.whatsapp) if supplier else None
    if not target:
        raise HTTPException(400, "Supplier has no WhatsApp group or number configured")

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
    result = _send_whatsapp_message(settings, target, msg)

    if "idMessage" in result:
        return {"message": "Expense sent to supplier", "id": result["idMessage"]}
    else:
        raise HTTPException(500, f"Failed to send: {result}")


@router.post("/send-sales")
def send_sales_whatsapp(
    branch_id: int = Form(...),
    report_date: Optional[str] = Form(None),
    lang: str = Form("en"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Send sales report to the branch's configured WhatsApp group (fallback to number)."""
    settings = db.query(WhatsAppSettings).first()
    if not _is_configured(settings):
        raise HTTPException(400, "WhatsApp not configured. Go to Settings to set up your provider credentials.")

    branch = db.query(Branch).filter(Branch.id == branch_id).first()
    if not branch:
        raise HTTPException(404, "Branch not found")
    target = getattr(branch, "whatsapp_group", None) or branch.whatsapp_number
    if not target:
        raise HTTPException(400, "Branch has no WhatsApp group or number configured")

    target_date = date.fromisoformat(report_date) if report_date else date.today()
    sale = db.query(Sale).filter(Sale.branch_id == branch_id, Sale.date == target_date).first()

    msg = build_sales_message(sale, branch, target_date, lang)
    result = _send_whatsapp_message(settings, target, msg)

    if "idMessage" in result:
        return {"message": "Sales report sent", "id": result["idMessage"]}
    else:
        raise HTTPException(500, f"Failed to send: {result}")

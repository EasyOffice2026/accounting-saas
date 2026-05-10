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
from app.utils.auth import get_current_user

router = APIRouter(prefix="/api/whatsapp", tags=["whatsapp"])


@router.get("/settings")
def get_settings(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role not in ("owner", "manager"):
        raise HTTPException(403, "Not authorized")
    s = db.query(WhatsAppSettings).first()
    if not s:
        return {"provider": "greenapi", "instance_id": "", "default_phone": "", "has_token": False}
    return {
        "provider": s.provider or "greenapi",
        "instance_id": s.instance_id or "",
        "default_phone": s.default_phone or "",
        "has_token": bool(s.api_token),
    }


@router.post("/settings")
def save_settings(
    instance_id: str = Form(""),
    api_token: str = Form(""),
    default_phone: str = Form(""),
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
    if default_phone:
        s.default_phone = default_phone
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


def _send_whatsapp_message(instance_id: str, api_token: str, phone: str, message: str) -> dict:
    """Send a WhatsApp message via Green API."""
    url = f"https://api.green-api.com/waInstance{instance_id}/sendMessage/{api_token}"
    # Ensure phone has country code, default to Kuwait (+965)
    phone = phone.strip().replace("+", "").replace(" ", "").replace("-", "")
    if len(phone) == 8:
        phone = "965" + phone
    payload = {
        "chatId": f"{phone}@c.us",
        "message": message,
    }
    resp = httpx.post(url, json=payload, timeout=30)
    return resp.json()


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
    result = _send_whatsapp_message(settings.instance_id, settings.api_token, target_phone, report)

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

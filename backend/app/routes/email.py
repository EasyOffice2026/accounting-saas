from fastapi import APIRouter, Depends, HTTPException, Form
from sqlalchemy.orm import Session
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

from app.database import get_db
from app.models.settings import SmtpSettings
from app.models.purchase import PurchaseOrder, PurchaseItem, Supplier
from app.models.branch import Branch
from app.models.user import User
from app.utils.auth import get_current_user

router = APIRouter(prefix="/api/email", tags=["email"])


@router.get("/smtp-settings")
def get_smtp_settings(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role not in ("owner", "manager"):
        raise HTTPException(403, "Only owner/manager can view SMTP settings")
    settings = db.query(SmtpSettings).first()
    if not settings:
        return None
    return {
        "id": settings.id,
        "smtp_host": settings.smtp_host,
        "smtp_port": settings.smtp_port,
        "smtp_user": settings.smtp_user,
        "from_email": settings.from_email,
        "from_name": settings.from_name,
        "use_tls": settings.use_tls,
        "has_password": bool(settings.smtp_password),
    }


@router.post("/smtp-settings")
def save_smtp_settings(
    smtp_host: str = Form(...), smtp_port: int = Form(587),
    smtp_user: str = Form(...), smtp_password: str = Form(""),
    from_email: str = Form(...), from_name: str = Form("Mudawwarah"),
    use_tls: bool = Form(True),
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    if user.role not in ("owner", "manager"):
        raise HTTPException(403, "Only owner/manager can update SMTP settings")
    settings = db.query(SmtpSettings).first()
    if settings:
        settings.smtp_host = smtp_host
        settings.smtp_port = smtp_port
        settings.smtp_user = smtp_user
        if smtp_password:
            settings.smtp_password = smtp_password
        settings.from_email = from_email
        settings.from_name = from_name
        settings.use_tls = use_tls
    else:
        settings = SmtpSettings(
            smtp_host=smtp_host, smtp_port=smtp_port,
            smtp_user=smtp_user, smtp_password=smtp_password,
            from_email=from_email, from_name=from_name, use_tls=use_tls,
        )
        db.add(settings)
    db.commit()
    db.refresh(settings)
    return {"status": "saved"}


@router.post("/test")
def test_smtp(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role not in ("owner", "manager"):
        raise HTTPException(403, "Only owner/manager can test SMTP")
    settings = db.query(SmtpSettings).first()
    if not settings:
        raise HTTPException(400, "SMTP not configured")
    try:
        msg = MIMEText("This is a test email from Mudawwarah system.", "plain")
        msg["Subject"] = "Mudawwarah - SMTP Test"
        msg["From"] = f"{settings.from_name} <{settings.from_email}>"
        msg["To"] = settings.from_email
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as server:
            if settings.use_tls:
                server.starttls()
            server.login(settings.smtp_user, settings.smtp_password)
            server.send_message(msg)
        return {"status": "sent", "message": f"Test email sent to {settings.from_email}"}
    except Exception as e:
        raise HTTPException(400, f"SMTP error: {str(e)}")


@router.post("/send-po/{order_id}")
def send_po_email(
    order_id: int,
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    settings = db.query(SmtpSettings).first()
    if not settings:
        raise HTTPException(400, "SMTP not configured. Go to Settings to configure email.")

    order = db.query(PurchaseOrder).filter(PurchaseOrder.id == order_id).first()
    if not order:
        raise HTTPException(404, "Order not found")

    supplier = db.query(Supplier).filter(Supplier.id == order.supplier_id).first()
    if not supplier or not supplier.email:
        raise HTTPException(400, "Supplier has no email address")

    branch = db.query(Branch).filter(Branch.id == order.branch_id).first()
    items = db.query(PurchaseItem).filter(PurchaseItem.purchase_order_id == order_id).all()

    branch_name = branch.name if branch else ""
    subject = f"Purchase Order #{order.id} - {branch_name} - {order.date}"

    # Build HTML email
    items_html = ""
    for i, item in enumerate(items, 1):
        items_html += f"""
        <tr>
            <td style="padding:8px;border:1px solid #ddd;">{i}</td>
            <td style="padding:8px;border:1px solid #ddd;">{item.item_name}</td>
            <td style="padding:8px;border:1px solid #ddd;text-align:center;">{item.quantity} {item.unit}</td>
            <td style="padding:8px;border:1px solid #ddd;text-align:right;">KD {item.unit_price:.3f}</td>
            <td style="padding:8px;border:1px solid #ddd;text-align:right;">KD {item.total:.3f}</td>
        </tr>"""

    html = f"""
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:#059669;color:white;padding:20px;text-align:center;">
            <h2 style="margin:0;">Purchase Order #{order.id}</h2>
            <p style="margin:5px 0 0;">Mudawwarah Restaurant Management</p>
        </div>
        <div style="padding:20px;background:#f9fafb;">
            <table style="width:100%;margin-bottom:15px;">
                <tr><td><strong>Date:</strong></td><td>{order.date}</td></tr>
                <tr><td><strong>Branch:</strong></td><td>{branch_name}</td></tr>
                <tr><td><strong>Supplier:</strong></td><td>{supplier.name}</td></tr>
                <tr><td><strong>Payment:</strong></td><td>{order.payment_type}</td></tr>
            </table>
            <table style="width:100%;border-collapse:collapse;margin-top:10px;">
                <thead>
                    <tr style="background:#059669;color:white;">
                        <th style="padding:8px;border:1px solid #ddd;">#</th>
                        <th style="padding:8px;border:1px solid #ddd;">Item</th>
                        <th style="padding:8px;border:1px solid #ddd;">Qty</th>
                        <th style="padding:8px;border:1px solid #ddd;">Unit Price</th>
                        <th style="padding:8px;border:1px solid #ddd;">Total</th>
                    </tr>
                </thead>
                <tbody>{items_html}</tbody>
                <tfoot>
                    <tr style="background:#ecfdf5;font-weight:bold;">
                        <td colspan="4" style="padding:8px;border:1px solid #ddd;text-align:right;">Total:</td>
                        <td style="padding:8px;border:1px solid #ddd;text-align:right;">KD {order.total_amount:.3f}</td>
                    </tr>
                </tfoot>
            </table>
        </div>
        <div style="background:#f3f4f6;padding:10px;text-align:center;font-size:12px;color:#6b7280;">
            Sent from Mudawwarah Restaurant Management System
        </div>
    </div>
    """

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = f"{settings.from_name} <{settings.from_email}>"
        msg["To"] = supplier.email

        # Plain text version
        plain = f"Purchase Order #{order.id}\nDate: {order.date}\nBranch: {branch_name}\n"
        plain += f"Supplier: {supplier.name}\nPayment: {order.payment_type}\n\nItems:\n"
        for i, item in enumerate(items, 1):
            plain += f"{i}. {item.item_name} - {item.quantity} {item.unit} x KD {item.unit_price:.3f} = KD {item.total:.3f}\n"
        plain += f"\nTotal: KD {order.total_amount:.3f}"

        msg.attach(MIMEText(plain, "plain"))
        msg.attach(MIMEText(html, "html"))

        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as server:
            if settings.use_tls:
                server.starttls()
            server.login(settings.smtp_user, settings.smtp_password)
            server.send_message(msg)

        return {"status": "sent", "message": f"Email sent to {supplier.email}"}
    except Exception as e:
        raise HTTPException(400, f"Failed to send email: {str(e)}")

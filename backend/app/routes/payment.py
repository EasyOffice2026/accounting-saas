from fastapi import APIRouter, Depends, HTTPException, Form, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from datetime import date
from typing import Optional
import httpx

from app.database import get_db
from app.models.payment import PaymentGatewaySettings, PaymentTransaction
from app.models.purchase import Invoice, PurchaseOrder
from app.models.user import User
from app.utils.auth import get_current_user

router = APIRouter(prefix="/api/payment", tags=["payment"])

import os

TAP_API_URL = "https://api.tap.company/v2"

# Sandbox test key loaded from environment variable
DEFAULT_SANDBOX_KEY = os.environ.get("TAP_SANDBOX_KEY", "")


def _get_tap_key(db: Session) -> str:
    settings = db.query(PaymentGatewaySettings).first()
    if settings and settings.secret_key:
        return settings.secret_key
    return DEFAULT_SANDBOX_KEY


def _is_sandbox(db: Session) -> bool:
    settings = db.query(PaymentGatewaySettings).first()
    if settings:
        return settings.is_sandbox == "true"
    return True


# --- Payment Gateway Settings ---
@router.get("/settings")
def get_payment_settings(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role not in ("owner", "manager"):
        raise HTTPException(403, "Only owner/manager can view payment settings")
    settings = db.query(PaymentGatewaySettings).first()
    if not settings:
        return {"provider": "tap", "is_sandbox": "true", "currency": "KWD",
                "secret_key": "", "publishable_key": "", "has_custom_key": False}
    return {
        "provider": settings.provider,
        "is_sandbox": settings.is_sandbox,
        "currency": settings.currency,
        "secret_key": "****" + settings.secret_key[-4:] if settings.secret_key else "",
        "publishable_key": settings.publishable_key or "",
        "has_custom_key": bool(settings.secret_key),
    }


@router.post("/settings")
def save_payment_settings(
    secret_key: str = Form(""), publishable_key: str = Form(""),
    is_sandbox: str = Form("true"), currency: str = Form("KWD"),
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    if user.role not in ("owner", "manager"):
        raise HTTPException(403, "Only owner/manager can edit payment settings")
    settings = db.query(PaymentGatewaySettings).first()
    if not settings:
        settings = PaymentGatewaySettings(provider="tap")
        db.add(settings)
    if secret_key and not secret_key.startswith("****"):
        settings.secret_key = secret_key
    if publishable_key:
        settings.publishable_key = publishable_key
    settings.is_sandbox = is_sandbox
    settings.currency = currency
    db.commit()
    return {"status": "saved"}


# --- Create Charge (redirect to Tap payment page) ---
@router.post("/charge/{invoice_id}")
def create_charge(invoice_id: int, request: Request,
                  db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    invoice = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not invoice:
        raise HTTPException(404, "Invoice not found")
    if invoice.status == "paid":
        raise HTTPException(400, "Invoice already paid")

    secret_key = _get_tap_key(db)
    is_sandbox = _is_sandbox(db)

    # Build redirect URL back to our app
    base_url = str(request.base_url).rstrip("/")
    redirect_url = f"{base_url}/api/payment/callback"

    payload = {
        "amount": round(invoice.total_amount, 3),
        "currency": "KWD",
        "customer_initiated": True,
        "threeDSecure": True,
        "save_card": False,
        "description": f"Invoice #{invoice.id} - PO #{invoice.purchase_order_id}",
        "metadata": {
            "invoice_id": str(invoice.id),
        },
        "reference": {
            "transaction": f"INV-{invoice.id}",
            "order": f"PO-{invoice.purchase_order_id}",
        },
        "receipt": {
            "email": False,
            "sms": False,
        },
        "redirect": {
            "url": redirect_url,
        },
        "source": {
            "id": "src_all",
        },
    }

    try:
        with httpx.Client() as client:
            resp = client.post(
                f"{TAP_API_URL}/charges",
                json=payload,
                headers={
                    "Authorization": f"Bearer {secret_key}",
                    "Content-Type": "application/json",
                },
                timeout=30,
            )
            data = resp.json()

        if resp.status_code not in (200, 201):
            raise HTTPException(400, f"Tap API error: {data.get('errors', data)}")

        charge_id = data.get("id", "")
        transaction_url = data.get("transaction", {}).get("url", "")

        # Save transaction record
        txn = PaymentTransaction(
            invoice_id=invoice.id,
            charge_id=charge_id,
            amount=invoice.total_amount,
            currency="KWD",
            status="initiated",
            provider="tap",
            redirect_url=transaction_url,
        )
        db.add(txn)
        db.commit()

        return {"charge_id": charge_id, "redirect_url": transaction_url}

    except httpx.HTTPError as e:
        raise HTTPException(500, f"Failed to connect to Tap: {str(e)}")


# --- Payment Callback (Tap redirects back here) ---
@router.get("/callback")
def payment_callback(tap_id: str = "", db: Session = Depends(get_db)):
    if not tap_id:
        return RedirectResponse("/?payment=error")

    secret_key = _get_tap_key(db)

    # Retrieve charge details from Tap
    try:
        with httpx.Client() as client:
            resp = client.get(
                f"{TAP_API_URL}/charges/{tap_id}",
                headers={"Authorization": f"Bearer {secret_key}"},
                timeout=30,
            )
            data = resp.json()
    except httpx.HTTPError:
        return RedirectResponse("/?payment=error")

    status = data.get("status", "")
    invoice_id_str = data.get("metadata", {}).get("invoice_id", "")

    # Update transaction record
    txn = db.query(PaymentTransaction).filter(PaymentTransaction.charge_id == tap_id).first()
    if txn:
        txn.status = "captured" if status == "CAPTURED" else "failed"
        db.commit()

    if status == "CAPTURED" and invoice_id_str:
        invoice_id = int(invoice_id_str)
        invoice = db.query(Invoice).filter(Invoice.id == invoice_id).first()
        if invoice and invoice.status != "paid":
            invoice.status = "paid"
            invoice.paid_amount = invoice.total_amount
            invoice.paid_date = date.today()
            db.commit()

            # Update PO status
            po = db.query(PurchaseOrder).filter(PurchaseOrder.id == invoice.purchase_order_id).first()
            if po:
                po.status = "paid"
                db.commit()

        return RedirectResponse(f"/?payment=success&invoice_id={invoice_id}")

    return RedirectResponse("/?payment=failed")


# --- Check payment status ---
@router.get("/status/{invoice_id}")
def payment_status(invoice_id: int, db: Session = Depends(get_db),
                   _=Depends(get_current_user)):
    txns = db.query(PaymentTransaction).filter(
        PaymentTransaction.invoice_id == invoice_id
    ).order_by(PaymentTransaction.created_at.desc()).all()
    return [{
        "id": t.id,
        "charge_id": t.charge_id,
        "amount": t.amount,
        "status": t.status,
        "provider": t.provider,
        "created_at": str(t.created_at),
    } for t in txns]

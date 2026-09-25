"""Payment channels (bank accounts, cards, KNET...) — Payment Management.

A channel's balance = opening + deposits − withdrawals − payments booked against it.
Payments are pulled from the Expense table (branch/office expenses, contracts, payroll,
renewals all mirror there) plus Purchase Office supplier payments. Only records dated on/after
CHANNEL_START_DATE count, so history before the go-live is untouched. Branch cash boxes are
never affected by channel payments.
"""
from fastapi import APIRouter, Depends, HTTPException, Form, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import date
from typing import Optional

from app.database import get_db
from app.models.channel import PaymentChannel, ChannelTransaction
from app.models.expense import Expense
from app.models.procurement import ProcPayment, ProcInvoice
from app.models.purchase import Supplier
from app.models.branch import Branch
from app.models.user import User
from app.utils.auth import get_current_user

router = APIRouter(prefix="/api/payment-channels", tags=["payment-channels"])

CHANNEL_START_DATE = date(2026, 10, 1)
MANAGE_ROLES = ("owner", "manager", "accountant")
CHANNEL_KINDS = ("bank", "card", "knet", "other")


def _manage(user: User):
    if user.role not in MANAGE_ROLES:
        raise HTTPException(403, "Only management / accountant can manage payment channels")


def _channel_or_404(db: Session, channel_id: int) -> PaymentChannel:
    ch = db.query(PaymentChannel).filter(PaymentChannel.id == channel_id).first()
    if not ch:
        raise HTTPException(404, "Payment channel not found")
    return ch


def channel_for_payment(db: Session, channel_id: str, user: User) -> Optional[int]:
    """Validate a channel chosen on a payment form (form value, may be ''); returns the id or None."""
    if not channel_id or not channel_id.strip().isdigit():
        return None
    ch = _channel_or_404(db, int(channel_id))
    if not ch.is_active:
        raise HTTPException(400, "Payment channel is inactive")
    allowed = user.get_allowed_brands()
    if allowed is not None and ch.brand_id and ch.brand_id not in allowed:
        raise HTTPException(403, "Payment channel belongs to another brand")
    return ch.id


def _payments_total(db: Session, channel_id: int, date_to: Optional[date] = None) -> float:
    eq = db.query(func.coalesce(func.sum(Expense.amount), 0)).filter(
        Expense.channel_id == channel_id, Expense.date >= CHANNEL_START_DATE)
    pq = db.query(func.coalesce(func.sum(ProcPayment.amount), 0)).filter(
        ProcPayment.channel_id == channel_id, ProcPayment.date >= CHANNEL_START_DATE)
    if date_to:
        eq = eq.filter(Expense.date <= date_to)
        pq = pq.filter(ProcPayment.date <= date_to)
    return float(eq.scalar()) + float(pq.scalar())


def _manual_total(db: Session, channel_id: int, txn_type: str, date_to: Optional[date] = None) -> float:
    q = db.query(func.coalesce(func.sum(ChannelTransaction.amount), 0)).filter(
        ChannelTransaction.channel_id == channel_id, ChannelTransaction.txn_type == txn_type)
    if date_to:
        q = q.filter(ChannelTransaction.date <= date_to)
    return float(q.scalar())


def channel_balance(db: Session, ch: PaymentChannel, date_to: Optional[date] = None) -> float:
    return round(
        (ch.opening_balance or 0)
        + _manual_total(db, ch.id, "deposit", date_to)
        - _manual_total(db, ch.id, "withdrawal", date_to)
        - _payments_total(db, ch.id, date_to), 3)


def _serialize(db: Session, ch: PaymentChannel, with_balance: bool = True) -> dict:
    d = {
        "id": ch.id, "brand_id": ch.brand_id, "name": ch.name, "name_ar": ch.name_ar,
        "kind": ch.kind, "account_no": ch.account_no,
        "opening_balance": ch.opening_balance or 0,
        "opening_date": str(ch.opening_date) if ch.opening_date else None,
        "is_active": bool(ch.is_active),
    }
    if with_balance:
        d["balance"] = channel_balance(db, ch)
    return d


@router.get("/")
def list_channels(
    brand_id: Optional[int] = Query(None),
    active_only: bool = Query(False),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    q = db.query(PaymentChannel)
    allowed = user.get_allowed_brands()
    if brand_id:
        q = q.filter((PaymentChannel.brand_id == brand_id) | (PaymentChannel.brand_id.is_(None)))
    elif allowed is not None:
        q = q.filter((PaymentChannel.brand_id.in_(allowed)) | (PaymentChannel.brand_id.is_(None)))
    if active_only:
        q = q.filter(PaymentChannel.is_active == True)
    rows = q.order_by(PaymentChannel.kind, PaymentChannel.name).all()
    return [_serialize(db, c, with_balance=user.role in MANAGE_ROLES + ("personnel_manager", "purchase_manager")) for c in rows]


@router.post("/")
def create_channel(
    name: str = Form(...),
    name_ar: str = Form(""),
    kind: str = Form("bank"),
    account_no: str = Form(""),
    opening_balance: float = Form(0),
    opening_date: str = Form(""),
    brand_id: Optional[int] = Form(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _manage(user)
    if kind not in CHANNEL_KINDS:
        raise HTTPException(400, "Invalid channel type")
    ch = PaymentChannel(
        name=name.strip(), name_ar=name_ar.strip() or None, kind=kind,
        account_no=account_no.strip() or None, opening_balance=opening_balance,
        opening_date=date.fromisoformat(opening_date) if opening_date else CHANNEL_START_DATE,
        brand_id=brand_id or None, is_active=True,
    )
    db.add(ch)
    db.commit()
    db.refresh(ch)
    return _serialize(db, ch)


@router.put("/{channel_id}")
def update_channel(
    channel_id: int,
    name: str = Form(...),
    name_ar: str = Form(""),
    kind: str = Form("bank"),
    account_no: str = Form(""),
    opening_balance: float = Form(0),
    opening_date: str = Form(""),
    brand_id: Optional[int] = Form(None),
    is_active: bool = Form(True),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _manage(user)
    if kind not in CHANNEL_KINDS:
        raise HTTPException(400, "Invalid channel type")
    ch = _channel_or_404(db, channel_id)
    ch.name = name.strip()
    ch.name_ar = name_ar.strip() or None
    ch.kind = kind
    ch.account_no = account_no.strip() or None
    ch.opening_balance = opening_balance
    ch.opening_date = date.fromisoformat(opening_date) if opening_date else ch.opening_date
    ch.brand_id = brand_id or None
    ch.is_active = is_active
    db.commit()
    return _serialize(db, ch)


@router.delete("/{channel_id}")
def delete_channel(channel_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _manage(user)
    ch = _channel_or_404(db, channel_id)
    used = (
        db.query(Expense.id).filter(Expense.channel_id == ch.id).first()
        or db.query(ProcPayment.id).filter(ProcPayment.channel_id == ch.id).first()
        or db.query(ChannelTransaction.id).filter(ChannelTransaction.channel_id == ch.id).first()
    )
    if used:
        ch.is_active = False
        db.commit()
        return {"status": "deactivated"}
    db.delete(ch)
    db.commit()
    return {"status": "deleted"}


@router.post("/{channel_id}/transactions")
def add_transaction(
    channel_id: int,
    txn_date: str = Form(...),
    txn_type: str = Form(...),
    amount: float = Form(...),
    reference: str = Form(""),
    notes: str = Form(""),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _manage(user)
    ch = _channel_or_404(db, channel_id)
    if txn_type not in ("deposit", "withdrawal"):
        raise HTTPException(400, "txn_type must be deposit or withdrawal")
    if amount <= 0:
        raise HTTPException(400, "Amount must be positive")
    t = ChannelTransaction(
        channel_id=ch.id, date=date.fromisoformat(txn_date), txn_type=txn_type, amount=round(amount, 3),
        reference=reference.strip() or None, notes=notes.strip() or None, created_by=user.id,
    )
    db.add(t)
    db.commit()
    return {"id": t.id, "balance": channel_balance(db, ch)}


@router.delete("/{channel_id}/transactions/{txn_id}")
def delete_transaction(channel_id: int, txn_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _manage(user)
    t = db.query(ChannelTransaction).filter(
        ChannelTransaction.id == txn_id, ChannelTransaction.channel_id == channel_id).first()
    if not t:
        raise HTTPException(404, "Transaction not found")
    db.delete(t)
    db.commit()
    return {"status": "deleted"}


@router.get("/{channel_id}/statement")
def statement(
    channel_id: int,
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in MANAGE_ROLES + ("personnel_manager", "purchase_manager"):
        raise HTTPException(403, "Not authorized")
    ch = _channel_or_404(db, channel_id)
    d_from = date.fromisoformat(date_from) if date_from else None
    d_to = date.fromisoformat(date_to) if date_to else None

    entries = []
    for t in db.query(ChannelTransaction).filter(ChannelTransaction.channel_id == ch.id).all():
        entries.append({
            "date": t.date, "id": f"txn-{t.id}", "txn_id": t.id, "source": t.txn_type,
            "description": t.reference or ("Deposit" if t.txn_type == "deposit" else "Withdrawal"),
            "head": "", "credit": t.amount if t.txn_type == "deposit" else 0,
            "debit": t.amount if t.txn_type == "withdrawal" else 0, "notes": t.notes,
        })
    exp_rows = (
        db.query(Expense, Branch.name)
        .join(Branch, Branch.id == Expense.branch_id)
        .filter(Expense.channel_id == ch.id, Expense.date >= CHANNEL_START_DATE).all()
    )
    for e, bname in exp_rows:
        src = "salary" if e.salary_payment_id else "contract" if e.contract_payment_id else "renewal" if e.renewal_request_id else "expense"
        entries.append({
            "date": e.date, "id": f"exp-{e.id}", "source": src, "description": e.description,
            "head": bname, "credit": 0, "debit": e.amount, "notes": e.notes,
        })
    pay_rows = (
        db.query(ProcPayment, ProcInvoice.invoice_number, Supplier.name)
        .join(ProcInvoice, ProcInvoice.id == ProcPayment.invoice_id)
        .join(Supplier, Supplier.id == ProcInvoice.supplier_id)
        .filter(ProcPayment.channel_id == ch.id, ProcPayment.date >= CHANNEL_START_DATE).all()
    )
    for p, inv_no, sup in pay_rows:
        entries.append({
            "date": p.date, "id": f"proc-{p.id}", "source": "supplier_payment",
            "description": f"{sup} — Inv {inv_no or ''}".strip(" —"), "head": "Purchase Office",
            "credit": 0, "debit": p.amount, "notes": p.reference,
        })
    entries.sort(key=lambda x: (x["date"], x["id"]))

    opening = ch.opening_balance or 0
    balance = opening
    out = []
    for e in entries:
        balance += e["credit"] - e["debit"]
        if d_from and e["date"] < d_from:
            opening = balance
            continue
        if d_to and e["date"] > d_to:
            continue
        out.append({**e, "date": str(e["date"]), "balance": round(balance, 3)})
    return {
        "channel": _serialize(db, ch, with_balance=False),
        "opening_balance": round(opening, 3),
        "total_in": round(sum(x["credit"] for x in out), 3),
        "total_out": round(sum(x["debit"] for x in out), 3),
        "closing_balance": round(out[-1]["balance"], 3) if out else round(opening, 3),
        "entries": out,
    }

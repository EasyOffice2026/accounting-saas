"""Purchase Office: an isolated procurement ledger.

Orders live in proc_* tables keyed by brand (never by an operating branch), so nothing here can enter
branch cash sheets, branch purchase totals, dashboards or reports. The only cash effect is a Cash Out
on the brand's "Purchase Office" cash box when an invoice is paid with purchase_petty_cash.
Delivery location is free text for logistics only.
"""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import date, datetime, timezone
from typing import Optional
import os, uuid, json

from app.database import get_db, UPLOAD_DIR
from app.models.procurement import ProcOrder, ProcOrderItem, ProcInvoice, ProcPayment, ProcOrderLog
from app.models.purchase import Supplier, SupplierItem, PurchaseCategory
from app.models.branch import Branch
from app.models.hr import Brand
from app.models.cash import CashTransaction
from app.models.user import User
from app.utils.auth import get_current_user, hash_password

router = APIRouter(prefix="/api/procurement", tags=["procurement"])

PURCHASE_OFFICER_ROLE = "purchase_officer"
PURCHASE_MANAGER_ROLE = "purchase_manager"
PURCHASE_ROLES = (PURCHASE_OFFICER_ROLE, PURCHASE_MANAGER_ROLE)  # restricted to the purchase module
PROC_ROLES = ("owner", "manager", "accountant", PURCHASE_OFFICER_ROLE, PURCHASE_MANAGER_ROLE)
APPROVER_ROLES = ("owner", "accountant", PURCHASE_MANAGER_ROLE)
PAYER_ROLES = ("owner", "accountant", PURCHASE_MANAGER_ROLE)  # pay invoices / manage the Purchase Office cash
PURCHASE_BRANCH_PREFIX = "Purchase Office"
PAYMENT_METHODS = ("purchase_petty_cash", "bank_transfer", "knet", "cheque")
PURCHASE_TABS = ["dashboard", "procurement", "cash"]

STATUS_FLOW = {
    "draft": "Draft", "pending": "Pending Approval", "approved": "Approved", "returned": "Returned",
    "rejected": "Rejected", "ordered": "Ordered", "received": "Received", "invoiced": "Invoiced",
    "paid": "Paid", "closed": "Closed", "cancelled": "Cancelled",
}


# ---------------------------------------------------------------- helpers

def _now():
    return datetime.now(timezone.utc)


def _require(user: User, roles=PROC_ROLES):
    if user.role not in roles:
        raise HTTPException(403, "Not authorized")


def _check_brand(user: User, brand_id: Optional[int]):
    allowed = user.get_allowed_brands()
    if allowed is not None and brand_id is not None and brand_id not in allowed:
        raise HTTPException(403, "Brand not allowed")


def purchase_branch(db: Session, brand_id: int, create: bool = True) -> Optional[Branch]:
    """The Purchase Office cash box branch for a brand (one per brand)."""
    b = db.query(Branch).filter(Branch.brand_id == brand_id,
                                Branch.name.like(f"{PURCHASE_BRANCH_PREFIX}%")).first()
    if b or not create:
        return b
    brand = db.query(Brand).filter(Brand.id == brand_id).first()
    suffix = f" - {brand.name_en}" if brand else ""
    suffix_ar = f" - {brand.name_ar or brand.name_en}" if brand else ""
    b = Branch(name=f"{PURCHASE_BRANCH_PREFIX}{suffix}", name_ar=f"مكتب المشتريات{suffix_ar}",
               brand_id=brand_id, is_central_kitchen=False, is_active=True)
    db.add(b)
    db.commit()
    db.refresh(b)
    return b


def is_purchase_branch(b: Branch) -> bool:
    return (b.name or "").startswith(PURCHASE_BRANCH_PREFIX)


def cash_balance(db: Session, branch_id: int) -> float:
    bal = 0.0
    rows = db.query(CashTransaction).filter(CashTransaction.branch_id == branch_id)\
        .order_by(CashTransaction.date.asc(), CashTransaction.id.asc()).all()
    for r in rows:
        if r.txn_type == "opening_balance":
            bal = r.amount
        elif r.category == "deposit":
            bal -= r.amount
        elif r.txn_type == "cash_in":
            bal += r.amount
        else:
            bal -= r.amount
    return round(bal, 3)


def seed_procurement(db: Session):
    """Idempotent: Purchase Office cash boxes per brand + purchaser / purchase.manager logins."""
    brands = db.query(Brand).all()
    for br in brands:
        purchase_branch(db, br.id)
    for username, password, full_name, role in (
        ("purchaser", "Purchaser@2026", "Purchase Officer", PURCHASE_OFFICER_ROLE),
        ("purchase.manager", "PurManager@2026", "Purchase Manager", PURCHASE_MANAGER_ROLE),
    ):
        u = db.query(User).filter(User.username == username).first()
        if not u:
            u = User(username=username, password_hash=hash_password(password),
                     full_name=full_name, role=role, branch_id=None)
            u.set_allowed_brands([b.id for b in brands] or None)
            db.add(u)
        if set(PURCHASE_TABS) - set(u.get_allowed_tabs() or []):
            u.set_allowed_tabs(sorted(set(u.get_allowed_tabs() or []) | set(PURCHASE_TABS)))
    db.commit()


def _save_upload(f: Optional[UploadFile]) -> Optional[str]:
    if not f or not f.filename:
        return None
    ext = os.path.splitext(f.filename)[1]
    fname = f"proc_{uuid.uuid4().hex}{ext}"
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    with open(os.path.join(UPLOAD_DIR, fname), "wb") as out:
        out.write(f.file.read())
    return fname


def _d(s: Optional[str]) -> Optional[date]:
    return date.fromisoformat(s) if s else None


def _dt(d) -> str:
    return d.isoformat(sep=" ")[:16] if d else ""


def _user_names(db: Session) -> dict:
    return {u.id: (u.full_name or u.username) for u in db.query(User).all()}


def _next_po_no(db: Session, brand_id: int) -> str:
    yr = date.today().year
    prefix = f"PO-{brand_id}-{yr}-"
    last = db.query(ProcOrder.po_no).filter(ProcOrder.po_no.like(f"{prefix}%"))\
        .order_by(ProcOrder.id.desc()).first()
    n = int(last[0].split("-")[-1]) + 1 if last else 1
    return f"{prefix}{n:04d}"


def _log(db: Session, order: ProcOrder, status: str, user: User, comment: str = ""):
    db.add(ProcOrderLog(order_id=order.id, status=status, comment=comment or None, user_id=user.id))


def _order_q(db: Session, user: User):
    q = db.query(ProcOrder)
    allowed = user.get_allowed_brands()
    if allowed is not None:
        q = q.filter(ProcOrder.brand_id.in_(allowed))
    return q


def _get_order(db: Session, user: User, order_id: int) -> ProcOrder:
    o = _order_q(db, user).filter(ProcOrder.id == order_id).first()
    if not o:
        raise HTTPException(404, "Purchase order not found")
    return o


def _item_out(i: ProcOrderItem) -> dict:
    return {"id": i.id, "supplier_item_id": i.supplier_item_id, "item_name": i.item_name,
            "item_name_ar": i.item_name_ar or "", "packaging": i.packaging or "", "unit": i.unit or "pcs",
            "quantity": i.quantity, "unit_price": i.unit_price, "total": i.total,
            "received_qty": i.received_qty, "received_total": i.received_total}


def order_out(db: Session, o: ProcOrder, detail: bool = False, names: Optional[dict] = None) -> dict:
    names = names if names is not None else _user_names(db)
    sup = db.query(Supplier).filter(Supplier.id == o.supplier_id).first()
    cat = db.query(PurchaseCategory).filter(PurchaseCategory.id == o.category_id).first() if o.category_id else None
    inv = db.query(ProcInvoice).filter(ProcInvoice.order_id == o.id).first()
    d = {
        "id": o.id, "po_no": o.po_no, "brand_id": o.brand_id, "supplier_id": o.supplier_id,
        "supplier_name": sup.name if sup else "", "category_id": o.category_id,
        "category_name": cat.name if cat else "", "date": str(o.date),
        "expected_date": str(o.expected_date) if o.expected_date else "",
        "payment_type": o.payment_type, "delivery_location": o.delivery_location or "",
        "total": round(o.total or 0, 3), "notes": o.notes or "", "status": o.status,
        "status_label": STATUS_FLOW.get(o.status, o.status), "attachment": o.attachment_path or "",
        "created_by": o.created_by, "created_by_name": names.get(o.created_by, ""),
        "created_at": _dt(o.created_at), "submitted_at": _dt(o.submitted_at),
        "approved_by_name": names.get(o.approved_by, ""), "approved_at": _dt(o.approved_at),
        "approval_comment": o.approval_comment or "", "ordered_at": _dt(o.ordered_at),
        "received_date": str(o.received_date) if o.received_date else "",
        "received_by_name": names.get(o.received_by, ""), "receiving_notes": o.receiving_notes or "",
        "receiving_attachment": o.receiving_attachment or "",
        "invoice_id": inv.id if inv else None, "invoice_status": inv.status if inv else "",
        "invoice_paid": round(inv.paid_amount or 0, 3) if inv else 0,
        "invoice_total": round(inv.total_amount or 0, 3) if inv else 0,
    }
    if detail:
        items = db.query(ProcOrderItem).filter(ProcOrderItem.order_id == o.id).order_by(ProcOrderItem.id).all()
        d["items"] = [_item_out(i) for i in items]
        d["item_count"] = len(items)
        d["logs"] = [{"status": l.status, "label": STATUS_FLOW.get(l.status, l.status), "comment": l.comment or "",
                      "user_name": names.get(l.user_id, ""), "at": _dt(l.at)}
                     for l in db.query(ProcOrderLog).filter(ProcOrderLog.order_id == o.id).order_by(ProcOrderLog.id).all()]
        d["invoice"] = invoice_out(db, inv, names) if inv else None
    else:
        d["item_count"] = db.query(func.count(ProcOrderItem.id)).filter(ProcOrderItem.order_id == o.id).scalar() or 0
    return d


def invoice_out(db: Session, inv: ProcInvoice, names: Optional[dict] = None) -> dict:
    names = names if names is not None else _user_names(db)
    sup = db.query(Supplier).filter(Supplier.id == inv.supplier_id).first()
    o = db.query(ProcOrder).filter(ProcOrder.id == inv.order_id).first()
    pays = db.query(ProcPayment).filter(ProcPayment.invoice_id == inv.id).order_by(ProcPayment.id).all()
    return {
        "id": inv.id, "order_id": inv.order_id, "po_no": o.po_no if o else "", "brand_id": inv.brand_id,
        "supplier_id": inv.supplier_id, "supplier_name": sup.name if sup else "",
        "payment_type": o.payment_type if o else "", "invoice_number": inv.invoice_number or "",
        "date": str(inv.date), "due_date": str(inv.due_date) if inv.due_date else "",
        "total_amount": round(inv.total_amount or 0, 3), "paid_amount": round(inv.paid_amount or 0, 3),
        "balance": round((inv.total_amount or 0) - (inv.paid_amount or 0), 3), "status": inv.status,
        "notes": inv.notes or "", "attachment": inv.attachment_path or "",
        "days_overdue": (date.today() - inv.due_date).days if inv.due_date and inv.status != "paid" and inv.due_date < date.today() else 0,
        "payments": [{"id": p.id, "date": str(p.date), "amount": p.amount, "method": p.method,
                      "reference": p.reference or "", "notes": p.notes or "", "cash_txn_id": p.cash_txn_id,
                      "created_by_name": names.get(p.created_by, "")} for p in pays],
    }


def _parse_items(db: Session, items_json: str) -> list:
    try:
        raw = json.loads(items_json or "[]")
    except json.JSONDecodeError:
        raise HTTPException(400, "Invalid items")
    out = []
    for it in raw:
        qty = float(it.get("quantity") or 0)
        price = float(it.get("unit_price") or 0)
        if qty <= 0:
            continue
        sid = it.get("supplier_item_id")
        si = db.query(SupplierItem).filter(SupplierItem.id == sid).first() if sid else None
        out.append(ProcOrderItem(
            supplier_item_id=si.id if si else None,
            item_name=(it.get("item_name") or (si.item_name if si else "")).strip() or "Item",
            item_name_ar=it.get("item_name_ar") or (si.item_name_ar if si else None),
            packaging=it.get("packaging") or (si.packaging if si else None),
            unit=it.get("unit") or (si.unit if si else "pcs"),
            quantity=qty, unit_price=price, total=round(qty * price, 3)))
    if not out:
        raise HTTPException(400, "At least one item with quantity is required")
    return out


# ---------------------------------------------------------------- dashboard / cash

@router.get("/dashboard")
def purchase_dashboard(brand_id: Optional[int] = None, db: Session = Depends(get_db),
                       user: User = Depends(get_current_user)):
    _require(user)
    _check_brand(user, brand_id)
    today = date.today()
    month_start = today.replace(day=1)
    q = _order_q(db, user)
    if brand_id:
        q = q.filter(ProcOrder.brand_id == brand_id)
    counts = {s: 0 for s in STATUS_FLOW}
    for st, n in q.with_entities(ProcOrder.status, func.count(ProcOrder.id)).group_by(ProcOrder.status).all():
        counts[st] = n
    active = q.filter(ProcOrder.status.notin_(("draft", "rejected", "cancelled")))
    month_total = active.filter(ProcOrder.date >= month_start).with_entities(func.coalesce(func.sum(ProcOrder.total), 0)).scalar() or 0
    cash_month = active.filter(ProcOrder.date >= month_start, ProcOrder.payment_type == "cash")\
        .with_entities(func.coalesce(func.sum(ProcOrder.total), 0)).scalar() or 0
    names = _user_names(db)
    recent = [order_out(db, o, names=names) for o in q.order_by(ProcOrder.id.desc()).limit(8).all()]

    iq = db.query(ProcInvoice)
    allowed = user.get_allowed_brands()
    if allowed is not None:
        iq = iq.filter(ProcInvoice.brand_id.in_(allowed))
    if brand_id:
        iq = iq.filter(ProcInvoice.brand_id == brand_id)
    open_inv = iq.filter(ProcInvoice.status != "paid").all()
    outstanding = round(sum((i.total_amount or 0) - (i.paid_amount or 0) for i in open_inv), 3)
    overdue = round(sum((i.total_amount or 0) - (i.paid_amount or 0) for i in open_inv
                        if i.due_date and i.due_date < today), 3)
    by_sup: dict = {}
    for i in open_inv:
        by_sup[i.supplier_id] = by_sup.get(i.supplier_id, 0) + (i.total_amount or 0) - (i.paid_amount or 0)
    sups = {s.id: s.name for s in db.query(Supplier).all()}
    top_suppliers = sorted([{"supplier_id": k, "supplier_name": sups.get(k, ""), "balance": round(v, 3)}
                            for k, v in by_sup.items()], key=lambda x: -x["balance"])[:8]

    pb = purchase_branch(db, brand_id, create=False) if brand_id else None
    cash_in_month = cash_out_month = 0.0
    recent_cash = []
    if pb:
        ctx = db.query(CashTransaction).filter(CashTransaction.branch_id == pb.id)
        for r in ctx.filter(CashTransaction.date >= month_start).all():
            if r.txn_type == "cash_in" and r.category != "deposit":
                cash_in_month += r.amount
            elif r.txn_type != "opening_balance":
                cash_out_month += r.amount
        recent_cash = [{"id": r.id, "date": str(r.date), "txn_type": r.txn_type, "category": r.category,
                        "amount": r.amount, "reference": r.reference or "", "notes": r.notes or ""}
                       for r in ctx.order_by(CashTransaction.date.desc(), CashTransaction.id.desc()).limit(8).all()]
    return {
        "petty_cash_branch_id": pb.id if pb else None,
        "petty_cash_branch_name": pb.name if pb else "",
        "petty_cash_balance": cash_balance(db, pb.id) if pb else 0,
        "cash_in_month": round(cash_in_month, 3), "cash_out_month": round(cash_out_month, 3),
        "purchases_month": round(float(month_total), 3), "cash_purchases_month": round(float(cash_month), 3),
        "credit_purchases_month": round(float(month_total) - float(cash_month), 3),
        "outstanding": outstanding, "overdue": overdue, "open_invoices": len(open_inv),
        "orders": counts, "recent_orders": recent, "recent_cash": recent_cash, "top_suppliers": top_suppliers,
    }


@router.get("/cash-box")
def cash_box(brand_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _require(user)
    _check_brand(user, brand_id)
    pb = purchase_branch(db, brand_id)
    return {"branch_id": pb.id, "branch_name": pb.name, "balance": cash_balance(db, pb.id)}


# ---------------------------------------------------------------- suppliers / items (read-only reuse)

@router.get("/suppliers")
def suppliers(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _require(user)
    cats = {c.id: c.name for c in db.query(PurchaseCategory).all()}
    return [{"id": s.id, "name": s.name, "payment_type": s.payment_type or "cash", "category_id": s.category_id,
             "category_name": cats.get(s.category_id, ""), "whatsapp": s.whatsapp or "", "email": s.email or ""}
            for s in db.query(Supplier).filter(Supplier.is_active == True).order_by(Supplier.name).all()]


@router.get("/suppliers/{supplier_id}/items")
def supplier_items(supplier_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _require(user)
    rows = db.query(SupplierItem).filter(SupplierItem.supplier_id == supplier_id, SupplierItem.is_active == True)\
        .order_by(SupplierItem.item_name).all()
    return [{"id": i.id, "item_name": i.item_name, "item_name_ar": i.item_name_ar or "", "packaging": i.packaging or "",
             "unit": i.unit or "pcs", "unit_price": i.unit_price or 0} for i in rows]


@router.get("/categories")
def categories(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _require(user)
    return [{"id": c.id, "name": c.name, "name_ar": c.name_ar or ""}
            for c in db.query(PurchaseCategory).filter(PurchaseCategory.is_active == True).order_by(PurchaseCategory.name).all()]


@router.get("/delivery-locations")
def delivery_locations(brand_id: Optional[int] = None, db: Session = Depends(get_db),
                       user: User = Depends(get_current_user)):
    """Operating branch names offered as delivery reference (text only, no accounting link)."""
    _require(user)
    q = db.query(Branch).filter(Branch.is_active == True, ~Branch.name.like("Personnel Office%"),
                                ~Branch.name.like(f"{PURCHASE_BRANCH_PREFIX}%"))
    if brand_id:
        q = q.filter(Branch.brand_id == brand_id)
    return [{"name": b.name, "name_ar": b.name_ar or ""} for b in q.order_by(Branch.name).all()]


# ---------------------------------------------------------------- orders

@router.get("/orders")
def list_orders(brand_id: Optional[int] = None, status: Optional[str] = None, supplier_id: Optional[int] = None,
                payment_type: Optional[str] = None, date_from: Optional[str] = None, date_to: Optional[str] = None,
                db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _require(user)
    _check_brand(user, brand_id)
    q = _order_q(db, user)
    if brand_id:
        q = q.filter(ProcOrder.brand_id == brand_id)
    if status:
        q = q.filter(ProcOrder.status.in_(status.split(",")))
    if supplier_id:
        q = q.filter(ProcOrder.supplier_id == supplier_id)
    if payment_type:
        q = q.filter(ProcOrder.payment_type == payment_type)
    if date_from:
        q = q.filter(ProcOrder.date >= _d(date_from))
    if date_to:
        q = q.filter(ProcOrder.date <= _d(date_to))
    names = _user_names(db)
    return [order_out(db, o, names=names) for o in q.order_by(ProcOrder.id.desc()).all()]


@router.get("/orders/{order_id}")
def get_order(order_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _require(user)
    return order_out(db, _get_order(db, user, order_id), detail=True)


@router.post("/orders")
def create_order(brand_id: int = Form(...), supplier_id: int = Form(...), category_id: Optional[int] = Form(None),
                 order_date: str = Form(...), expected_date: str = Form(""), payment_type: str = Form("cash"),
                 delivery_location: str = Form(""), items: str = Form("[]"), notes: str = Form(""),
                 submit: bool = Form(False), attachment: Optional[UploadFile] = File(None),
                 db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _require(user)
    _check_brand(user, brand_id)
    if payment_type not in ("cash", "credit"):
        raise HTTPException(400, "payment_type must be cash or credit")
    if not db.query(Supplier).filter(Supplier.id == supplier_id).first():
        raise HTTPException(404, "Supplier not found")
    lines = _parse_items(db, items)
    o = ProcOrder(po_no=_next_po_no(db, brand_id), brand_id=brand_id, supplier_id=supplier_id,
                  category_id=category_id or None, date=_d(order_date) or date.today(),
                  expected_date=_d(expected_date), payment_type=payment_type,
                  delivery_location=delivery_location.strip() or None, notes=notes or None,
                  total=round(sum(l.total for l in lines), 3), status="draft", created_by=user.id,
                  attachment_path=_save_upload(attachment))
    db.add(o)
    db.flush()
    for l in lines:
        l.order_id = o.id
        db.add(l)
    _log(db, o, "draft", user)
    if submit:
        o.status, o.submitted_at = "pending", _now()
        _log(db, o, "pending", user)
    db.commit()
    return order_out(db, o, detail=True)


@router.put("/orders/{order_id}")
def update_order(order_id: int, supplier_id: int = Form(...), category_id: Optional[int] = Form(None),
                 order_date: str = Form(...), expected_date: str = Form(""), payment_type: str = Form("cash"),
                 delivery_location: str = Form(""), items: str = Form("[]"), notes: str = Form(""),
                 submit: bool = Form(False), attachment: Optional[UploadFile] = File(None),
                 db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _require(user)
    o = _get_order(db, user, order_id)
    if o.status not in ("draft", "returned"):
        raise HTTPException(400, "Only draft / returned orders can be edited")
    if payment_type not in ("cash", "credit"):
        raise HTTPException(400, "payment_type must be cash or credit")
    lines = _parse_items(db, items)
    db.query(ProcOrderItem).filter(ProcOrderItem.order_id == o.id).delete()
    for l in lines:
        l.order_id = o.id
        db.add(l)
    o.supplier_id, o.category_id = supplier_id, category_id or None
    o.date, o.expected_date, o.payment_type = _d(order_date) or o.date, _d(expected_date), payment_type
    o.delivery_location, o.notes = delivery_location.strip() or None, notes or None
    o.total = round(sum(l.total for l in lines), 3)
    att = _save_upload(attachment)
    if att:
        o.attachment_path = att
    if submit:
        o.status, o.submitted_at = "pending", _now()
        _log(db, o, "pending", user)
    db.commit()
    return order_out(db, o, detail=True)


@router.post("/orders/{order_id}/submit")
def submit_order(order_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _require(user)
    o = _get_order(db, user, order_id)
    if o.status not in ("draft", "returned"):
        raise HTTPException(400, "Order is not a draft")
    o.status, o.submitted_at = "pending", _now()
    _log(db, o, "pending", user)
    db.commit()
    return order_out(db, o, detail=True)


@router.post("/orders/{order_id}/approve")
def approve_order(order_id: int, action: str = Form(...), comment: str = Form(""),
                  db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """action: approve | return | reject — Owner, Purchase Manager, Accountant only."""
    _require(user, APPROVER_ROLES)
    o = _get_order(db, user, order_id)
    if o.status != "pending":
        raise HTTPException(400, "Order is not pending approval")
    if o.created_by == user.id and user.role != "owner":
        raise HTTPException(400, "You cannot approve your own order")
    if action == "approve":
        o.status, o.approved_by, o.approved_at, o.approval_comment = "approved", user.id, _now(), comment or None
    elif action == "return":
        o.status, o.approval_comment = "returned", comment or None
    elif action == "reject":
        o.status, o.approved_by, o.approved_at, o.approval_comment = "rejected", user.id, _now(), comment or None
    else:
        raise HTTPException(400, "Invalid action")
    _log(db, o, o.status, user, comment)
    db.commit()
    return order_out(db, o, detail=True)


@router.post("/orders/{order_id}/order")
def mark_ordered(order_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Purchase Officer issues the approved PO to the supplier."""
    _require(user)
    o = _get_order(db, user, order_id)
    if o.status != "approved":
        raise HTTPException(400, "Order must be approved first")
    o.status, o.ordered_at = "ordered", _now()
    _log(db, o, "ordered", user)
    db.commit()
    return order_out(db, o, detail=True)


@router.post("/orders/{order_id}/receive")
def receive_order(order_id: int, received_date: str = Form(...), received: str = Form("[]"),
                  notes: str = Form(""), attachment: Optional[UploadFile] = File(None),
                  db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """received: [{item_id, received_qty}] — missing items default to ordered qty."""
    _require(user)
    o = _get_order(db, user, order_id)
    if o.status not in ("approved", "ordered"):
        raise HTTPException(400, "Order must be approved / ordered before receiving")
    try:
        rec = {int(r["item_id"]): float(r.get("received_qty") or 0) for r in json.loads(received or "[]")}
    except (json.JSONDecodeError, KeyError, ValueError):
        raise HTTPException(400, "Invalid received data")
    total = 0.0
    for it in db.query(ProcOrderItem).filter(ProcOrderItem.order_id == o.id).all():
        it.received_qty = rec.get(it.id, it.quantity)
        it.received_total = round(it.received_qty * it.unit_price, 3)
        total += it.received_total
    o.status, o.received_date, o.received_by = "received", _d(received_date) or date.today(), user.id
    o.receiving_notes = notes or None
    att = _save_upload(attachment)
    if att:
        o.receiving_attachment = att
    o.total = round(total, 3)
    _log(db, o, "received", user, notes)
    db.commit()
    return order_out(db, o, detail=True)


@router.post("/orders/{order_id}/cancel")
def cancel_order(order_id: int, comment: str = Form(""), db: Session = Depends(get_db),
                 user: User = Depends(get_current_user)):
    _require(user)
    o = _get_order(db, user, order_id)
    if o.status in ("invoiced", "paid", "closed", "cancelled"):
        raise HTTPException(400, "Order cannot be cancelled at this stage")
    if o.status not in ("draft", "returned") and user.role not in APPROVER_ROLES:
        raise HTTPException(403, "Only an approver can cancel a submitted order")
    o.status = "cancelled"
    _log(db, o, "cancelled", user, comment)
    db.commit()
    return order_out(db, o, detail=True)


@router.delete("/orders/{order_id}")
def delete_order(order_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _require(user)
    o = _get_order(db, user, order_id)
    if o.status != "draft":
        raise HTTPException(400, "Only drafts can be deleted")
    db.query(ProcOrderItem).filter(ProcOrderItem.order_id == o.id).delete()
    db.query(ProcOrderLog).filter(ProcOrderLog.order_id == o.id).delete()
    db.delete(o)
    db.commit()
    return {"status": "deleted"}


# ---------------------------------------------------------------- invoices / payments / ledger

@router.post("/orders/{order_id}/invoice")
def create_invoice(order_id: int, invoice_number: str = Form(""), invoice_date: str = Form(...),
                   due_date: str = Form(""), total_amount: Optional[float] = Form(None), notes: str = Form(""),
                   attachment: Optional[UploadFile] = File(None),
                   db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Record the supplier invoice for a received order (cash or credit)."""
    _require(user)
    o = _get_order(db, user, order_id)
    if o.status != "received":
        raise HTTPException(400, "Order must be received before invoicing")
    if db.query(ProcInvoice).filter(ProcInvoice.order_id == o.id).first():
        raise HTTPException(400, "Invoice already recorded")
    amount = round(total_amount if total_amount is not None else (o.total or 0), 3)
    if amount <= 0:
        raise HTTPException(400, "Invoice amount must be positive")
    inv = ProcInvoice(order_id=o.id, brand_id=o.brand_id, supplier_id=o.supplier_id,
                      invoice_number=invoice_number or None, date=_d(invoice_date) or date.today(),
                      due_date=_d(due_date), total_amount=amount, paid_amount=0, status="pending",
                      notes=notes or None, attachment_path=_save_upload(attachment))
    db.add(inv)
    o.status, o.total = "invoiced", amount
    _log(db, o, "invoiced", user, invoice_number)
    db.commit()
    return invoice_out(db, inv)


@router.get("/invoices")
def list_invoices(brand_id: Optional[int] = None, supplier_id: Optional[int] = None, status: Optional[str] = None,
                  payment_type: Optional[str] = None, db: Session = Depends(get_db),
                  user: User = Depends(get_current_user)):
    _require(user)
    _check_brand(user, brand_id)
    q = db.query(ProcInvoice)
    allowed = user.get_allowed_brands()
    if allowed is not None:
        q = q.filter(ProcInvoice.brand_id.in_(allowed))
    if brand_id:
        q = q.filter(ProcInvoice.brand_id == brand_id)
    if supplier_id:
        q = q.filter(ProcInvoice.supplier_id == supplier_id)
    if status:
        q = q.filter(ProcInvoice.status.in_(status.split(",")))
    if payment_type:
        q = q.join(ProcOrder, ProcOrder.id == ProcInvoice.order_id).filter(ProcOrder.payment_type == payment_type)
    names = _user_names(db)
    return [invoice_out(db, i, names) for i in q.order_by(ProcInvoice.id.desc()).all()]


@router.post("/invoices/{invoice_id}/pay")
def pay_invoice(invoice_id: int, amount: float = Form(...), method: str = Form("purchase_petty_cash"),
                pay_date: str = Form(...), reference: str = Form(""), notes: str = Form(""),
                db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Owner / Purchase Manager / Accountant. Only purchase_petty_cash touches (the Purchase Office) cash."""
    _require(user, PAYER_ROLES)
    inv = db.query(ProcInvoice).filter(ProcInvoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(404, "Invoice not found")
    _check_brand(user, inv.brand_id)
    if method not in PAYMENT_METHODS:
        raise HTTPException(400, "Invalid payment method")
    amount = round(amount, 3)
    balance = round((inv.total_amount or 0) - (inv.paid_amount or 0), 3)
    if amount <= 0 or amount > balance + 0.0005:
        raise HTTPException(400, f"Amount must be between 0 and the outstanding balance ({balance})")
    o = db.query(ProcOrder).filter(ProcOrder.id == inv.order_id).first()
    pd = _d(pay_date) or date.today()
    txn_id = None
    if method == "purchase_petty_cash":
        pb = purchase_branch(db, inv.brand_id)
        if cash_balance(db, pb.id) < amount:
            raise HTTPException(400, "Insufficient Purchase Office petty cash")
        sup = db.query(Supplier).filter(Supplier.id == inv.supplier_id).first()
        txn = CashTransaction(branch_id=pb.id, date=pd, txn_type="cash_out", category="purchase", amount=amount,
                              reference=o.po_no if o else None,
                              notes=f"{sup.name if sup else ''}{' · Inv ' + inv.invoice_number if inv.invoice_number else ''}",
                              created_by=user.id)
        db.add(txn)
        db.flush()
        txn_id = txn.id
    p = ProcPayment(invoice_id=inv.id, date=pd, amount=amount, method=method, reference=reference or None,
                    notes=notes or None, cash_txn_id=txn_id, created_by=user.id)
    db.add(p)
    inv.paid_amount = round((inv.paid_amount or 0) + amount, 3)
    if inv.paid_amount >= (inv.total_amount or 0) - 0.0005:
        inv.status = "paid"
        if o:
            o.status, o.closed_at = "paid", _now()
            _log(db, o, "paid", user, f"{method} {amount}")
    else:
        inv.status = "partial"
        if o:
            _log(db, o, "invoiced", user, f"partial payment {method} {amount}")
    db.commit()
    return invoice_out(db, inv)


@router.get("/ledger")
def supplier_ledger(brand_id: Optional[int] = None, supplier_id: Optional[int] = None,
                    db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Per-supplier totals for Purchase Office invoices; optionally the full statement of one supplier."""
    _require(user)
    _check_brand(user, brand_id)
    q = db.query(ProcInvoice)
    allowed = user.get_allowed_brands()
    if allowed is not None:
        q = q.filter(ProcInvoice.brand_id.in_(allowed))
    if brand_id:
        q = q.filter(ProcInvoice.brand_id == brand_id)
    if supplier_id:
        q = q.filter(ProcInvoice.supplier_id == supplier_id)
    invs = q.all()
    sups = {s.id: s for s in db.query(Supplier).all()}
    today = date.today()
    agg: dict = {}
    for i in invs:
        a = agg.setdefault(i.supplier_id, {"supplier_id": i.supplier_id, "supplier_name": sups[i.supplier_id].name if i.supplier_id in sups else "",
                                           "invoices": 0, "invoiced": 0.0, "paid": 0.0, "balance": 0.0, "overdue": 0.0, "open_invoices": 0})
        bal = (i.total_amount or 0) - (i.paid_amount or 0)
        a["invoices"] += 1
        a["invoiced"] += i.total_amount or 0
        a["paid"] += i.paid_amount or 0
        a["balance"] += bal
        if i.status != "paid":
            a["open_invoices"] += 1
            if i.due_date and i.due_date < today:
                a["overdue"] += bal
    rows = [{k: (round(v, 3) if isinstance(v, float) else v) for k, v in a.items()} for a in agg.values()]
    rows.sort(key=lambda x: -x["balance"])
    out = {"suppliers": rows, "total_balance": round(sum(r["balance"] for r in rows), 3),
           "total_overdue": round(sum(r["overdue"] for r in rows), 3)}
    if supplier_id:
        stmt = []
        for i in sorted(invs, key=lambda x: (x.date, x.id)):
            o = db.query(ProcOrder).filter(ProcOrder.id == i.order_id).first()
            stmt.append({"date": str(i.date), "kind": "invoice", "ref": i.invoice_number or (o.po_no if o else ""),
                         "po_no": o.po_no if o else "", "debit": round(i.total_amount or 0, 3), "credit": 0.0})
            for p in db.query(ProcPayment).filter(ProcPayment.invoice_id == i.id).all():
                stmt.append({"date": str(p.date), "kind": "payment", "ref": p.reference or p.method,
                             "po_no": o.po_no if o else "", "debit": 0.0, "credit": round(p.amount, 3)})
        stmt.sort(key=lambda x: x["date"])
        run = 0.0
        for s in stmt:
            run += s["debit"] - s["credit"]
            s["balance"] = round(run, 3)
        out["statement"] = stmt
    return out


# ---------------------------------------------------------------- exports / print

@router.get("/export/orders/{fmt}")
def export_orders(fmt: str, brand_id: Optional[int] = None, status: Optional[str] = None,
                  supplier_id: Optional[int] = None, payment_type: Optional[str] = None,
                  date_from: Optional[str] = None, date_to: Optional[str] = None,
                  db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    from app.routes.export import _respond
    rows = list_orders(brand_id=brand_id, status=status, supplier_id=supplier_id, payment_type=payment_type,
                       date_from=date_from, date_to=date_to, db=db, user=user)
    header = ["PO No", "Date", "Supplier", "Category", "Cash/Credit", "Delivery Location", "Items", "Total (KD)",
              "Status", "Prepared By", "Approved By", "Received", "Invoice Paid (KD)"]
    data = [[r["po_no"], r["date"], r["supplier_name"], r["category_name"], r["payment_type"].title(),
             r["delivery_location"], r["item_count"], r["total"], r["status_label"], r["created_by_name"],
             r["approved_by_name"], r["received_date"], r["invoice_paid"]] for r in rows]
    return _respond(fmt, header, data, "purchase_office_orders", title="Purchase Office - Purchase Orders")


@router.get("/export/invoices/{fmt}")
def export_invoices(fmt: str, brand_id: Optional[int] = None, supplier_id: Optional[int] = None,
                    status: Optional[str] = None, db: Session = Depends(get_db),
                    user: User = Depends(get_current_user)):
    from app.routes.export import _respond
    rows = list_invoices(brand_id=brand_id, supplier_id=supplier_id, status=status, db=db, user=user)
    header = ["Invoice No", "Date", "Due Date", "PO No", "Supplier", "Cash/Credit", "Total (KD)", "Paid (KD)",
              "Balance (KD)", "Status", "Days Overdue"]
    data = [[r["invoice_number"], r["date"], r["due_date"], r["po_no"], r["supplier_name"], r["payment_type"].title(),
             r["total_amount"], r["paid_amount"], r["balance"], r["status"].title(), r["days_overdue"] or ""] for r in rows]
    return _respond(fmt, header, data, "purchase_office_invoices", title="Purchase Office - Supplier Invoices")


@router.get("/export/ledger/{fmt}")
def export_ledger(fmt: str, brand_id: Optional[int] = None, db: Session = Depends(get_db),
                  user: User = Depends(get_current_user)):
    from app.routes.export import _respond
    led = supplier_ledger(brand_id=brand_id, db=db, user=user)
    header = ["Supplier", "Invoices", "Open Invoices", "Invoiced (KD)", "Paid (KD)", "Balance (KD)", "Overdue (KD)"]
    data = [[r["supplier_name"], r["invoices"], r["open_invoices"], r["invoiced"], r["paid"], r["balance"], r["overdue"]]
            for r in led["suppliers"]]
    return _respond(fmt, header, data, "purchase_office_supplier_ledger", title="Purchase Office - Supplier Ledger")


@router.get("/orders/{order_id}/form.pdf")
def order_pdf(order_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Printable purchase order (A4)."""
    from fastapi.responses import Response
    from reportlab.lib.pagesizes import A4
    from reportlab.lib import colors
    from reportlab.lib.units import mm
    from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    import io
    import arabic_reshaper
    from bidi.algorithm import get_display

    _require(user)
    o = _get_order(db, user, order_id)
    d = order_out(db, o, detail=True)
    brand = db.query(Brand).filter(Brand.id == o.brand_id).first()
    sup = db.query(Supplier).filter(Supplier.id == o.supplier_id).first()

    dvs = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    dvsb = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
    if "DejaVuSans" not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(TTFont("DejaVuSans", dvs))
    if "DejaVuSans-Bold" not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(TTFont("DejaVuSans-Bold", dvsb))

    def ar(text: str) -> str:
        return get_display(arabic_reshaper.reshape(text)) if text else ""

    normal = ParagraphStyle("n", fontName="DejaVuSans", fontSize=9, leading=12)
    bold = ParagraphStyle("b", fontName="DejaVuSans-Bold", fontSize=9, leading=12)
    title = ParagraphStyle("t", fontName="DejaVuSans-Bold", fontSize=14, leading=18, alignment=1)
    sub = ParagraphStyle("s", fontName="DejaVuSans", fontSize=10, leading=13, alignment=1, textColor=colors.grey)
    small = ParagraphStyle("sm", fontName="DejaVuSans", fontSize=8, leading=10, textColor=colors.grey)
    right = ParagraphStyle("r", fontName="DejaVuSans", fontSize=9, leading=12, alignment=2)
    rightb = ParagraphStyle("rb", fontName="DejaVuSans-Bold", fontSize=9, leading=12, alignment=2)

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm,
                            topMargin=15 * mm, bottomMargin=15 * mm)
    el = []
    el.append(Paragraph(f"{brand.name_en}  {ar(brand.name_ar or '')}" if brand else "", title))
    el.append(Paragraph(f"PURCHASE ORDER  ·  {ar('أمر شراء')}  ·  Purchase Office", sub))
    el.append(Spacer(1, 4 * mm))

    info = [
        [Paragraph("PO No", bold), Paragraph(d["po_no"], normal), Paragraph("Status", bold), Paragraph(d["status_label"], normal)],
        [Paragraph("PO Date", bold), Paragraph(d["date"], normal), Paragraph("Expected Delivery", bold), Paragraph(d["expected_date"] or "-", normal)],
        [Paragraph("Supplier", bold), Paragraph(sup.name if sup else "", normal), Paragraph("Payment Terms", bold),
         Paragraph("Cash" if o.payment_type == "cash" else "Credit", normal)],
        [Paragraph("Supplier Contact", bold), Paragraph(" / ".join(x for x in [sup.whatsapp if sup else "", sup.email if sup else ""] if x) or "-", normal),
         Paragraph("Category", bold), Paragraph(d["category_name"] or "-", normal)],
        [Paragraph("Deliver To (reference)", bold), Paragraph(d["delivery_location"] or "-", normal),
         Paragraph("Prepared By", bold), Paragraph(d["created_by_name"], normal)],
        [Paragraph("Approved By", bold), Paragraph(f"{d['approved_by_name']} {d['approved_at']}".strip() or "-", normal),
         Paragraph("Ordered On", bold), Paragraph(d["ordered_at"] or "-", normal)],
    ]
    it = Table(info, colWidths=[35 * mm, 60 * mm, 35 * mm, 50 * mm])
    it.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.4, colors.grey),
                            ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#E3F2FD")),
                            ("BACKGROUND", (2, 0), (2, -1), colors.HexColor("#E3F2FD")),
                            ("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
    el.append(it)
    el.append(Spacer(1, 5 * mm))

    rows = [[Paragraph("#", bold), Paragraph("Item", bold), Paragraph("Packaging", bold), Paragraph("Unit", bold),
             Paragraph("Qty", rightb), Paragraph("Unit Price", rightb), Paragraph("Total (KD)", rightb)]]
    for n, li in enumerate(d["items"], 1):
        name = li["item_name"] + (f"  {ar(li['item_name_ar'])}" if li["item_name_ar"] else "")
        rows.append([Paragraph(str(n), normal), Paragraph(name, normal), Paragraph(li["packaging"] or "-", normal),
                     Paragraph(li["unit"], normal), Paragraph(f"{li['quantity']:g}", right),
                     Paragraph(f"{li['unit_price']:.3f}", right), Paragraph(f"{li['total']:.3f}", right)])
    rows.append([Paragraph("", normal), Paragraph("TOTAL", bold), "", "", "", "", Paragraph(f"{d['total']:.3f}", rightb)])
    lt = Table(rows, colWidths=[8 * mm, 70 * mm, 30 * mm, 15 * mm, 15 * mm, 20 * mm, 22 * mm], repeatRows=1)
    lt.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.4, colors.grey),
                            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#BBDEFB")),
                            ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor("#F5F5F5")),
                            ("VALIGN", (0, 0), (-1, -1), "MIDDLE")]))
    el.append(lt)
    el.append(Spacer(1, 4 * mm))
    if d["notes"]:
        el.append(Paragraph(f"<b>Notes:</b> {d['notes']}", normal))
        el.append(Spacer(1, 4 * mm))
    el.append(Paragraph("This purchase order is issued by the Purchase Office. Delivery location is for logistics only; "
                        "no cost is allocated to any branch.", small))
    el.append(Spacer(1, 12 * mm))
    sig = Table([[Paragraph("Prepared by (Purchase Officer)", normal), Paragraph("Approved by", normal),
                  Paragraph("Received by", normal), Paragraph("Supplier", normal)],
                 [Paragraph("______________________", normal)] * 4],
                colWidths=[45 * mm] * 4)
    el.append(sig)
    doc.build(el)
    return Response(content=buf.getvalue(), media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="{d["po_no"]}.pdf"'})

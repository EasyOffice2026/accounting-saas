from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import date as date_cls
from app.database import get_db
from app.models.cash import CashTransaction, CashBalance
from app.models.sale import Sale
from app.models.purchase import PurchaseOrder
from app.models.expense import Expense
from app.utils.auth import get_current_user
from app.models.user import User
from app.routes.hr import _brand_branch_ids

PERSONNEL_ROLES = ("personnel", "personnel_manager", "purchase_officer", "purchase_manager")  # office-box-only roles
VIEW_ONLY_ROLES = ("personnel", "purchase_officer", "staff")  # branch cash entries are made by management / accountants only

router = APIRouter(prefix="/api/cash", tags=["cash"])


def _personnel_branch_ids(db: Session, user: User) -> list:
    from app.models.branch import Branch
    from app.routes.renewals import PERSONNEL_BRANCH_PREFIX
    from app.routes.procurement import PURCHASE_BRANCH_PREFIX
    prefix = PURCHASE_BRANCH_PREFIX if user.role.startswith("purchase") else PERSONNEL_BRANCH_PREFIX
    q = db.query(Branch.id).filter(Branch.name.like(f"{prefix}%"))
    allowed = user.get_allowed_brands()
    if allowed is not None:
        q = q.filter(Branch.brand_id.in_(allowed))
    return [b.id for b in q.all()]


def _guard_personnel(db: Session, user: User, branch_id: int):
    """Personnel / Purchase Office roles can only operate their own office cash boxes."""
    if user.role in PERSONNEL_ROLES and branch_id not in _personnel_branch_ids(db, user):
        raise HTTPException(403, "This role can only access its own office petty cash")


@router.get("/transactions")
def list_transactions(
    branch_id: int = Query(None),
    brand_id: int = Query(None),
    date_from: str = Query(None),
    date_to: str = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    q = db.query(CashTransaction)
    bb_ids = _brand_branch_ids(db, brand_id)
    if user.role in PERSONNEL_ROLES:
        pids = _personnel_branch_ids(db, user)
        q = q.filter(CashTransaction.branch_id.in_([branch_id] if branch_id in pids else pids))
    elif user.role == "staff" and user.branch_id:
        q = q.filter(CashTransaction.branch_id == user.branch_id)
    elif branch_id:
        q = q.filter(CashTransaction.branch_id == branch_id)
    elif bb_ids is not None:
        q = q.filter(CashTransaction.branch_id.in_(bb_ids))
    if date_from:
        q = q.filter(CashTransaction.date >= date_from)
    if date_to:
        q = q.filter(CashTransaction.date <= date_to)
    rows = q.order_by(CashTransaction.date.asc(), CashTransaction.id.asc()).all()
    # Calculate running balance
    balance = 0.0
    result = []
    for r in rows:
        if r.txn_type == "opening_balance":
            balance = r.amount
        elif r.category == "deposit":
            balance -= r.amount  # deposit to bank reduces cash on hand
        elif r.txn_type == "cash_in":
            balance += r.amount
        else:  # cash_out
            balance -= r.amount
        result.append({
            "id": r.id, "branch_id": r.branch_id, "date": str(r.date),
            "txn_type": r.txn_type, "category": r.category,
            "amount": r.amount, "reference": r.reference, "notes": r.notes,
            "balance": round(balance, 3),
        })
    return result


@router.post("/transactions")
def create_transaction(
    branch_id: int = Query(...),
    txn_date: str = Query(...),
    txn_type: str = Query(...),
    category: str = Query(...),
    amount: float = Query(...),
    reference: str = Query(None),
    notes: str = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role in VIEW_ONLY_ROLES:
        raise HTTPException(403, "This role has view-only access to petty cash")
    _guard_personnel(db, user, branch_id)
    # An "opening_balance" category anchors the running balance, so store it
    # with the special opening_balance txn_type regardless of the chosen type.
    if category == "opening_balance":
        txn_type = "opening_balance"
    t = CashTransaction(
        branch_id=branch_id, date=date_cls.fromisoformat(txn_date), txn_type=txn_type,
        category=category, amount=amount, reference=reference,
        notes=notes, created_by=user.id,
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    return {"id": t.id, "status": "created"}


@router.get("/summary")
def cash_summary(
    branch_id: int = Query(...),
    summary_date: str = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _guard_personnel(db, user, branch_id)
    target_date = date_cls.fromisoformat(summary_date) if summary_date else date_cls.today()
    return _box_summary(db, branch_id, target_date)


def _box_summary(db: Session, branch_id: int, target_date: date_cls) -> dict:

    # Cash sales for this branch on this date
    cash_sales = db.query(func.coalesce(func.sum(Sale.physical_cash), 0)).filter(
        Sale.branch_id == branch_id, Sale.date == target_date
    ).scalar()

    # Cash purchases
    cash_purchases = db.query(func.coalesce(func.sum(PurchaseOrder.total_amount), 0)).filter(
        PurchaseOrder.branch_id == branch_id,
        PurchaseOrder.date == target_date,
        PurchaseOrder.payment_type == "cash",
    ).scalar()

    # Cash expenses
    cash_expenses = db.query(func.coalesce(func.sum(Expense.amount), 0)).filter(
        Expense.branch_id == branch_id,
        Expense.date == target_date,
        Expense.payment_method == "cash",
    ).scalar()

    # Manual transactions (deposits are tracked separately below to avoid double counting)
    cash_in_manual = db.query(func.coalesce(func.sum(CashTransaction.amount), 0)).filter(
        CashTransaction.branch_id == branch_id,
        CashTransaction.date == target_date,
        CashTransaction.txn_type == "cash_in",
        CashTransaction.category != "deposit",
    ).scalar()

    cash_out_manual = db.query(func.coalesce(func.sum(CashTransaction.amount), 0)).filter(
        CashTransaction.branch_id == branch_id,
        CashTransaction.date == target_date,
        CashTransaction.txn_type == "cash_out",
        CashTransaction.category != "deposit",
    ).scalar()

    deposits = db.query(func.coalesce(func.sum(CashTransaction.amount), 0)).filter(
        CashTransaction.branch_id == branch_id,
        CashTransaction.date == target_date,
        CashTransaction.category == "deposit",
    ).scalar()

    # Opening balance = sum of ALL prior cash activity before target_date
    # If an opening_balance transaction exists, use it as the starting point
    ob_txn = db.query(CashTransaction).filter(
        CashTransaction.branch_id == branch_id,
        CashTransaction.date < target_date,
        CashTransaction.txn_type == "opening_balance",
    ).order_by(CashTransaction.date.desc(), CashTransaction.id.desc()).first()

    ob_start = ob_txn.amount if ob_txn else 0
    ob_date = ob_txn.date if ob_txn else None

    # Sum ALL prior-day cash flows before target_date (from ob_date if set, otherwise all time)
    date_filter_sales = Sale.date < target_date
    date_filter_po = PurchaseOrder.date < target_date
    date_filter_exp = Expense.date < target_date
    date_filter_txn = CashTransaction.date < target_date
    if ob_date:
        date_filter_sales = (Sale.date >= ob_date) & (Sale.date < target_date)
        date_filter_po = (PurchaseOrder.date >= ob_date) & (PurchaseOrder.date < target_date)
        date_filter_exp = (Expense.date >= ob_date) & (Expense.date < target_date)
        date_filter_txn = (CashTransaction.date >= ob_date) & (CashTransaction.date < target_date)

    # Prior days' cash sales
    prior_sales = float(db.query(func.coalesce(func.sum(Sale.physical_cash), 0)).filter(
        Sale.branch_id == branch_id, date_filter_sales,
    ).scalar())
    # Prior days' cash purchases
    prior_purchases = float(db.query(func.coalesce(func.sum(PurchaseOrder.total_amount), 0)).filter(
        PurchaseOrder.branch_id == branch_id, date_filter_po,
        PurchaseOrder.payment_type == "cash",
    ).scalar())
    # Prior days' cash expenses
    prior_expenses = float(db.query(func.coalesce(func.sum(Expense.amount), 0)).filter(
        Expense.branch_id == branch_id, date_filter_exp,
        Expense.payment_method == "cash",
    ).scalar())
    # Prior days' manual cash_in (excluding deposits, tracked separately)
    prior_cash_in = float(db.query(func.coalesce(func.sum(CashTransaction.amount), 0)).filter(
        CashTransaction.branch_id == branch_id, date_filter_txn,
        CashTransaction.txn_type == "cash_in",
        CashTransaction.category != "deposit",
    ).scalar())
    # Prior days' manual cash_out (excluding deposits, tracked separately)
    prior_cash_out = float(db.query(func.coalesce(func.sum(CashTransaction.amount), 0)).filter(
        CashTransaction.branch_id == branch_id, date_filter_txn,
        CashTransaction.txn_type == "cash_out",
        CashTransaction.category != "deposit",
    ).scalar())
    # Prior days' deposits (money moved to bank, reduces cash on hand)
    prior_deposits = float(db.query(func.coalesce(func.sum(CashTransaction.amount), 0)).filter(
        CashTransaction.branch_id == branch_id, date_filter_txn,
        CashTransaction.category == "deposit",
    ).scalar())

    opening_balance = ob_start + (prior_sales + prior_cash_in) - (prior_purchases + prior_expenses + prior_cash_out + prior_deposits)

    total_in = float(opening_balance) + float(cash_sales) + float(cash_in_manual)
    total_out = float(cash_purchases) + float(cash_expenses) + float(cash_out_manual) + float(deposits)
    closing_balance = total_in - total_out

    return {
        "date": str(target_date),
        "branch_id": branch_id,
        "opening_balance": float(opening_balance),
        "cash_sales": float(cash_sales),
        "petty_cash_in": float(cash_in_manual),
        "cash_purchases": float(cash_purchases),
        "cash_expenses": float(cash_expenses),
        "cash_withdrawn": float(cash_out_manual),
        "deposited": float(deposits),
        "closing_balance": closing_balance,
        "total_in": total_in,
        "total_out": total_out,
    }


@router.post("/save-balance")
def save_balance(
    branch_id: int = Query(...),
    balance_date: str = Query(...),
    opening_balance: float = Query(0),
    deposited: float = Query(0),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role in VIEW_ONLY_ROLES:
        raise HTTPException(403, "This role has view-only access to petty cash")
    _guard_personnel(db, user, branch_id)
    existing = db.query(CashBalance).filter(
        CashBalance.branch_id == branch_id,
        CashBalance.date == balance_date,
    ).first()

    summary = cash_summary(
        branch_id=branch_id, summary_date=balance_date, db=db, user=user
    )

    if existing:
        existing.opening_balance = opening_balance
        existing.cash_sales = summary["cash_sales"]
        existing.petty_cash_in = summary["petty_cash_in"]
        existing.cash_purchases = summary["cash_purchases"]
        existing.cash_expenses = summary["cash_expenses"]
        existing.cash_withdrawn = summary["cash_withdrawn"]
        existing.deposited = deposited
        existing.closing_balance = opening_balance + summary["total_in"] - summary["total_out"]
    else:
        bal = CashBalance(
            branch_id=branch_id, date=balance_date,
            opening_balance=opening_balance,
            cash_sales=summary["cash_sales"],
            petty_cash_in=summary["petty_cash_in"],
            cash_purchases=summary["cash_purchases"],
            cash_expenses=summary["cash_expenses"],
            cash_withdrawn=summary["cash_withdrawn"],
            deposited=deposited,
            closing_balance=opening_balance + summary["total_in"] - summary["total_out"],
            created_by=user.id,
        )
        db.add(bal)

    # Record deposit as transaction if > 0
    if deposited > 0:
        dep_exists = db.query(CashTransaction).filter(
            CashTransaction.branch_id == branch_id,
            CashTransaction.date == balance_date,
            CashTransaction.category == "deposit",
        ).first()
        if not dep_exists:
            db.add(CashTransaction(
                branch_id=branch_id, date=balance_date,
                txn_type="cash_out", category="deposit",
                amount=deposited, created_by=user.id,
            ))

    db.commit()
    return {"status": "saved"}


DAILY_ROLES = ("owner", "manager", "accountant")
DAILY_KEYS = ("opening_balance", "cash_sales", "petty_cash_in", "cash_expenses",
              "cash_purchases", "cash_withdrawn", "deposited", "closing_balance")


def _daily_rows(db: Session, user: User, target_date: date_cls, brand_id: int = None) -> list:
    from app.models.branch import Branch
    from app.models.hr import Brand
    q = db.query(Branch).filter(
        Branch.is_active == True,  # noqa: E712
        Branch.is_central_kitchen == False,  # noqa: E712
        ~Branch.name.like("Personnel Office%"),
        ~Branch.name.like("Purchase Office%"),
        ~Branch.name.like("Administration%"),
        ~Branch.name.like("Central%"),
    )
    allowed = user.get_allowed_brands()
    if allowed is not None:
        q = q.filter(Branch.brand_id.in_(allowed))
    if brand_id:
        q = q.filter(Branch.brand_id == brand_id)
    brands = {b.id: b for b in db.query(Brand).all()}
    rows = []
    for br in q.order_by(Branch.brand_id, Branch.id).all():
        s = _box_summary(db, br.id, target_date)
        brand = brands.get(br.brand_id)
        rows.append({
            "branch_id": br.id,
            "branch": br.name,
            "branch_ar": br.name_ar or "",
            "brand": brand.name_en if brand else "",
            "brand_ar": (brand.name_ar or "") if brand else "",
            **{k: round(float(s[k]), 3) for k in DAILY_KEYS},
        })
    return rows


@router.get("/daily")
def daily_summary(
    summary_date: str = Query(None),
    brand_id: int = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in DAILY_ROLES:
        raise HTTPException(403, "Not authorized")
    target_date = date_cls.fromisoformat(summary_date) if summary_date else date_cls.today()
    rows = _daily_rows(db, user, target_date, brand_id)
    totals = {k: round(sum(r[k] for r in rows), 3) for k in DAILY_KEYS}
    return {"date": str(target_date), "rows": rows, "totals": totals}


@router.get("/daily/export/{fmt}")
def export_daily_summary(
    fmt: str,
    summary_date: str = Query(None),
    brand_id: int = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    from app.routes.export import _respond
    if user.role not in DAILY_ROLES:
        raise HTTPException(403, "Not authorized")
    target_date = date_cls.fromisoformat(summary_date) if summary_date else date_cls.today()
    rows = _daily_rows(db, user, target_date, brand_id)
    header = ["Brand", "Branch", "Opening Balance", "Cash Sales", "Cash In",
              "Expenses", "Purchases", "Cash Out", "Deposits", "Closing Balance"]
    data = [[r["brand"], r["branch"]] + [f"{r[k]:.3f}" for k in DAILY_KEYS] for r in rows]
    data.append(["", "TOTAL"] + [f"{sum(r[k] for r in rows):.3f}" for k in DAILY_KEYS])
    return _respond(fmt, header, data, f"daily_cash_summary_{target_date}",
                    f"Daily Cash Summary - {target_date}", summary_rows=1)

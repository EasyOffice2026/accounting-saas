from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional

from app.database import get_db
from app.models.sale import Sale
from app.models.purchase import PurchaseOrder
from app.models.expense import Expense
from app.models.hr import Employee
from app.models.branch import Branch
from app.models.transfer import TransferOrder, TransferOrderLine
from app.models.user import User
from app.utils.auth import get_current_user, get_business_user
from app.routes.hr import _brand_branch_ids, _exclude_left_employees
from app.utils.dates import apply_date_range

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"], dependencies=[Depends(get_business_user)])

SALE_AMOUNT = (
    func.coalesce(Sale.physical_cash, 0) + func.coalesce(Sale.physical_knet, 0)
    + func.coalesce(Sale.physical_link, 0) + func.coalesce(Sale.physical_wamd, 0)
    + func.coalesce(Sale.physical_talabat, 0) + func.coalesce(Sale.physical_keeta, 0)
    + func.coalesce(Sale.physical_jahez, 0) + func.coalesce(Sale.physical_other, 0)
)


def _transfers_by_branch(db: Session, date_from=None, date_to=None) -> dict[int, float]:
    """Value of goods dispatched to each branch, keyed by receiving branch."""
    rows = db.query(
        TransferOrder.requesting_branch_id,
        func.coalesce(
            func.sum(TransferOrderLine.dispatched_qty * TransferOrderLine.unit_price), 0
        ),
    ).join(
        TransferOrderLine, TransferOrderLine.transfer_order_id == TransferOrder.id
    ).filter(
        TransferOrder.status.in_(["dispatched", "received"]),
        TransferOrderLine.dispatched_qty != None,
    )
    rows = apply_date_range(rows, TransferOrder.date, date_from, date_to)
    rows = rows.group_by(TransferOrder.requesting_branch_id).all()
    return {bid: float(total or 0) for bid, total in rows}


@router.get("/")
def dashboard(branch_id: Optional[int] = None, brand_id: Optional[int] = None,
              date_from: Optional[str] = None, date_to: Optional[str] = None,
              db: Session = Depends(get_db),
              user: User = Depends(get_current_user)):
    if user.role == "staff":
        raise HTTPException(403, "Dashboard is not available for branch logins")
    bb_ids = _brand_branch_ids(db, brand_id)

    def apply_branch(q, model):
        bid = branch_id or (user.branch_id if user.role == "staff" else None)
        if bid:
            q = q.filter(model.branch_id == bid)
        elif bb_ids is not None:
            q = q.filter(model.branch_id.in_(bb_ids))
        return q

    def dated(q, model):
        return apply_date_range(q, model.date, date_from, date_to)

    def by_branch(model, amount) -> dict[int, float]:
        q = dated(apply_branch(
            db.query(model.branch_id, func.coalesce(func.sum(amount), 0)), model,
        ), model)
        return {bid: float(total or 0) for bid, total in q.group_by(model.branch_id).all()}

    sales_by_branch = by_branch(Sale, SALE_AMOUNT)
    purchases_by_branch = by_branch(PurchaseOrder, PurchaseOrder.total_amount)
    expenses_by_branch = by_branch(Expense, Expense.amount)
    sales_count = dated(apply_branch(db.query(func.count(Sale.id)), Sale), Sale).scalar() or 0
    total_sales = sum(sales_by_branch.values())
    total_purchases = sum(purchases_by_branch.values())
    total_expenses = sum(expenses_by_branch.values())

    transfers_by_branch = _transfers_by_branch(db, date_from, date_to)

    employee_count = apply_branch(
        _exclude_left_employees(db.query(func.count(Employee.id))),
        Employee,
    ).scalar() or 0

    # Branch-wise breakdown (staff sees only own branch)
    staff_bid = branch_id or (user.branch_id if user.role == "staff" else None)
    if staff_bid:
        branches = db.query(Branch).filter(Branch.id == staff_bid).all()
    elif bb_ids is not None:
        branches = db.query(Branch).filter(Branch.id.in_(bb_ids)).all()
    else:
        branches = db.query(Branch).all()
    branch_data = []
    for b in branches:
        branch_data.append({
            "branch_id": b.id,
            "branch_name": b.name,
            "sales": round(sales_by_branch.get(b.id, 0), 3),
            "purchases": round(purchases_by_branch.get(b.id, 0), 3),
            "expenses": round(expenses_by_branch.get(b.id, 0), 3),
            "transfers": round(transfers_by_branch.get(b.id, 0), 3),
        })

    total_transfers = sum(b["transfers"] for b in branch_data)

    return {
        "total_sales": total_sales,
        "total_purchases": total_purchases,
        "total_expenses": total_expenses,
        "total_transfers": round(total_transfers, 3),
        "employee_count": employee_count,
        "sales_count": sales_count,
        "branch_data": branch_data,
    }

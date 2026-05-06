from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional

from app.database import get_db
from app.models.sale import Sale
from app.models.purchase import PurchaseOrder
from app.models.expense import Expense
from app.models.hr import Employee
from app.models.branch import Branch
from app.models.user import User
from app.utils.auth import get_current_user

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])

SALES_CHANNELS = ["cash", "knet", "link", "wamd", "talabat", "keeta", "jahez", "other"]


def _sum_sales(rows):
    return sum(
        sum(getattr(r, f"physical_{ch}", 0) or 0 for ch in SALES_CHANNELS)
        for r in rows
    )


@router.get("/")
def dashboard(branch_id: Optional[int] = None, db: Session = Depends(get_db),
              user: User = Depends(get_current_user)):
    def apply_branch(q, model):
        bid = branch_id or (user.branch_id if user.role == "staff" else None)
        if bid:
            q = q.filter(model.branch_id == bid)
        return q

    sales = apply_branch(db.query(Sale), Sale).all()
    total_sales = _sum_sales(sales)

    total_purchases = apply_branch(
        db.query(func.coalesce(func.sum(PurchaseOrder.total_amount), 0)),
        PurchaseOrder,
    ).scalar() or 0

    total_expenses = apply_branch(
        db.query(func.coalesce(func.sum(Expense.amount), 0)),
        Expense,
    ).scalar() or 0

    employee_count = apply_branch(
        db.query(func.count(Employee.id)).filter(Employee.is_active == True),
        Employee,
    ).scalar() or 0

    # Branch-wise breakdown
    branches = db.query(Branch).all()
    branch_data = []
    for b in branches:
        b_sales = db.query(Sale).filter(Sale.branch_id == b.id).all()
        b_purchases = db.query(func.coalesce(func.sum(PurchaseOrder.total_amount), 0)).filter(
            PurchaseOrder.branch_id == b.id
        ).scalar() or 0
        b_expenses = db.query(func.coalesce(func.sum(Expense.amount), 0)).filter(
            Expense.branch_id == b.id
        ).scalar() or 0
        branch_data.append({
            "branch_id": b.id,
            "branch_name": b.name,
            "sales": round(_sum_sales(b_sales), 3),
            "purchases": round(float(b_purchases), 3),
            "expenses": round(float(b_expenses), 3),
        })

    return {
        "total_sales": total_sales,
        "total_purchases": float(total_purchases),
        "total_expenses": float(total_expenses),
        "employee_count": employee_count,
        "sales_count": len(sales),
        "branch_data": branch_data,
    }

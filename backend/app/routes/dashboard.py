from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional

from app.database import get_db
from app.models.sale import Sale
from app.models.purchase import PurchaseOrder
from app.models.expense import Expense
from app.models.hr import Employee
from app.models.user import User
from app.utils.auth import get_current_user

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("/")
def dashboard(branch_id: Optional[int] = None, db: Session = Depends(get_db),
              user: User = Depends(get_current_user)):
    def apply_branch(q, model):
        bid = branch_id or (user.branch_id if user.role == "staff" else None)
        if bid:
            q = q.filter(model.branch_id == bid)
        return q

    sales = apply_branch(db.query(Sale), Sale).all()
    total_sales = sum(
        (r.physical_cash or 0) + (r.physical_knet or 0) + (r.physical_link or 0) +
        (r.physical_wamd or 0) + (r.physical_talabat or 0) + (r.physical_keeta or 0) +
        (r.physical_jahez or 0) + (r.physical_other or 0) for r in sales
    )

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

    return {
        "total_sales": total_sales,
        "total_purchases": float(total_purchases),
        "total_expenses": float(total_expenses),
        "employee_count": employee_count,
        "sales_count": len(sales),
    }

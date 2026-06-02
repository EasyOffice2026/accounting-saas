from fastapi import APIRouter, Depends, Query, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from typing import Optional
import io, csv

from app.database import get_db
from app.models.sale import Sale
from app.models.purchase import PurchaseOrder
from app.models.expense import Expense
from app.models.hr import Employee, SalaryPayment
from app.models.cash import CashBalance
from app.models.branch import Branch
from app.utils.auth import get_current_user
from app.models.user import User

router = APIRouter(prefix="/api/export", tags=["export"])

channels = ["cash", "knet", "link", "talabat", "keeta", "jahez"]


def _branch_map(db: Session):
    return {b.id: b.name for b in db.query(Branch).all()}


@router.get("/sales/csv")
def export_sales_csv(branch_id: Optional[int] = None, db: Session = Depends(get_db),
                     user: User = Depends(get_current_user)):
    bmap = _branch_map(db)
    q = db.query(Sale)
    if branch_id:
        q = q.filter(Sale.branch_id == branch_id)
    elif user.role == "staff" and user.branch_id:
        q = q.filter(Sale.branch_id == user.branch_id)
    rows = q.order_by(Sale.date.desc()).all()

    output = io.StringIO()
    writer = csv.writer(output)
    header = ["Date", "Branch"]
    for prefix in ["Foodics", "Physical"]:
        for ch in channels:
            header.append(f"{prefix} {ch.title()}")
        header.append(f"{prefix} Total")
    header.append("Difference")
    writer.writerow(header)

    for r in rows:
        row = [str(r.date), bmap.get(r.branch_id, "")]
        for prefix in ["foodics", "physical"]:
            total = 0
            for ch in channels:
                val = getattr(r, f"{prefix}_{ch}", 0) or 0
                row.append(val)
                total += val
            row.append(total)
        f_total = sum(getattr(r, f"foodics_{ch}", 0) or 0 for ch in channels)
        p_total = sum(getattr(r, f"physical_{ch}", 0) or 0 for ch in channels)
        row.append(p_total - f_total)
        writer.writerow(row)

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=sales.csv"},
    )


@router.get("/purchases/csv")
def export_purchases_csv(branch_id: Optional[int] = None, db: Session = Depends(get_db),
                         user: User = Depends(get_current_user)):
    bmap = _branch_map(db)
    q = db.query(PurchaseOrder)
    if branch_id:
        q = q.filter(PurchaseOrder.branch_id == branch_id)
    elif user.role == "staff" and user.branch_id:
        q = q.filter(PurchaseOrder.branch_id == user.branch_id)
    rows = q.order_by(PurchaseOrder.date.desc()).all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Date", "Branch", "Supplier ID", "Payment Type", "Total Amount", "Status", "Notes"])
    for r in rows:
        writer.writerow([str(r.date), bmap.get(r.branch_id, ""), r.supplier_id,
                         r.payment_type, r.total_amount, r.status, r.notes or ""])
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=purchases.csv"},
    )


@router.get("/expenses/csv")
def export_expenses_csv(branch_id: Optional[int] = None, db: Session = Depends(get_db),
                        user: User = Depends(get_current_user)):
    bmap = _branch_map(db)
    q = db.query(Expense)
    if branch_id:
        q = q.filter(Expense.branch_id == branch_id)
    elif user.role == "staff" and user.branch_id:
        q = q.filter(Expense.branch_id == user.branch_id)
    rows = q.order_by(Expense.date.desc()).all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Date", "Branch", "Description", "Amount", "Payment Method", "Notes"])
    for r in rows:
        writer.writerow([str(r.date), bmap.get(r.branch_id, ""), r.description,
                         r.amount, r.payment_method, r.notes or ""])
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=expenses.csv"},
    )


@router.get("/hr/csv")
def export_hr_csv(branch_id: Optional[int] = None, db: Session = Depends(get_db),
                  user: User = Depends(get_current_user)):
    bmap = _branch_map(db)
    q = db.query(Employee)
    if branch_id:
        q = q.filter(Employee.branch_id == branch_id)
    elif user.role == "staff" and user.branch_id:
        q = q.filter(Employee.branch_id == user.branch_id)
    rows = q.order_by(Employee.name).all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Staff No.", "Name", "Name (AR)", "Branch", "Civil ID", "Position", "Phone",
                     "Employer", "Work Permit Salary", "Actual Salary", "Salary Transfer", "IBAN", "Bank",
                     "Join Date", "Active"])
    for r in rows:
        writer.writerow([r.staff_no or "", r.name, r.name_ar or "", bmap.get(r.branch_id, ""), r.civil_id or "",
                         r.position or "", r.phone or "", r.employer or "",
                         r.work_permit_salary or 0, r.actual_salary or 0,
                         r.salary_transfer_method or "", r.iban or "", r.bank_name or "",
                         str(r.join_date) if r.join_date else "", "Yes" if r.is_active else "No"])
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=hr.csv"},
    )


@router.get("/cash/csv")
def export_cash_csv(branch_id: Optional[int] = None, db: Session = Depends(get_db),
                    user: User = Depends(get_current_user)):
    bmap = _branch_map(db)
    q = db.query(CashBalance)
    if branch_id:
        q = q.filter(CashBalance.branch_id == branch_id)
    rows = q.order_by(CashBalance.date.desc()).all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Date", "Branch", "Opening Balance", "Cash Sales", "Petty Cash In",
                     "Cash Purchases", "Cash Expenses", "Cash Withdrawn", "Deposited", "Closing Balance"])
    for r in rows:
        writer.writerow([str(r.date), bmap.get(r.branch_id, ""), r.opening_balance, r.cash_sales,
                         r.petty_cash_in, r.cash_purchases, r.cash_expenses, r.cash_withdrawn,
                         r.deposited, r.closing_balance])
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=cash_management.csv"},
    )


@router.get("/salary/csv")
def export_salary_csv(month: Optional[str] = None, db: Session = Depends(get_db),
                      user: User = Depends(get_current_user)):
    if user.role not in ("owner", "manager"):
        raise HTTPException(status_code=403, detail="Not authorized")
    bmap = _branch_map(db)
    emp_map = {e.id: e for e in db.query(Employee).all()}
    q = db.query(SalaryPayment)
    if month:
        q = q.filter(SalaryPayment.month == month)
    rows = q.order_by(SalaryPayment.month.desc()).all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["Month", "Staff No.", "Name", "Position", "Branch", "Days Worked",
                     "Basic Salary", "Incentive", "Bonus", "Leave Salary", "Ticket", "Overtime",
                     "Total Allowances", "Absence Deduction", "Loan Deduction", "Penalty",
                     "Other Deduction", "Total Deductions", "Net Salary", "Payment Method", "Status"])
    for r in rows:
        emp = emp_map.get(r.employee_id)
        writer.writerow([
            r.month, emp.staff_no if emp else "", emp.name if emp else "",
            emp.position if emp else "", bmap.get(emp.branch_id, "") if emp else "",
            r.days_worked or 30, r.basic_salary,
            r.incentive or 0, r.bonus or 0, r.leave_salary or 0, r.ticket_payment or 0, r.overtime or 0,
            r.allowances or 0, r.absence_deduction or 0, r.loan_deduction or 0, r.penalty or 0,
            r.other_deduction or 0, r.deductions or 0, r.net_salary,
            r.payment_method or "", r.status,
        ])
    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=salary_{month or 'all'}.csv"},
    )

from fastapi import APIRouter, Depends, Form, HTTPException
from sqlalchemy.orm import Session
from datetime import date, time
from typing import Optional
import calendar

from app.database import get_db
from app.models.hr import Employee, Attendance, SalaryPayment
from app.models.user import User
from app.utils.auth import get_current_user

router = APIRouter(prefix="/api/hr", tags=["hr"])


# --- Employees ---
@router.get("/employees")
def list_employees(branch_id: Optional[int] = None, db: Session = Depends(get_db),
                   user: User = Depends(get_current_user)):
    q = db.query(Employee)
    if branch_id:
        q = q.filter(Employee.branch_id == branch_id)
    elif user.role == "staff" and user.branch_id:
        q = q.filter(Employee.branch_id == user.branch_id)
    return q.all()


@router.post("/employees")
def create_employee(
    branch_id: int = Form(...), name: str = Form(...),
    name_ar: str = Form(""), civil_id: str = Form(""),
    position: str = Form(""), phone: str = Form(""),
    salary: float = Form(0), join_date: str = Form(""),
    db: Session = Depends(get_db), _=Depends(get_current_user),
):
    emp = Employee(
        branch_id=branch_id, name=name, name_ar=name_ar,
        civil_id=civil_id, position=position, phone=phone,
        salary=salary,
        join_date=date.fromisoformat(join_date) if join_date else None,
    )
    db.add(emp)
    db.commit()
    db.refresh(emp)
    return emp


# --- Attendance ---
@router.get("/attendance")
def list_attendance(employee_id: Optional[int] = None, att_date: Optional[str] = None,
                    db: Session = Depends(get_db), _=Depends(get_current_user)):
    q = db.query(Attendance)
    if employee_id:
        q = q.filter(Attendance.employee_id == employee_id)
    if att_date:
        q = q.filter(Attendance.date == date.fromisoformat(att_date))
    return q.order_by(Attendance.date.desc()).all()


@router.post("/attendance")
def mark_attendance(
    employee_id: int = Form(...), att_date: str = Form(...),
    check_in: str = Form(""), check_out: str = Form(""),
    status: str = Form("present"), notes: str = Form(""),
    db: Session = Depends(get_db), _=Depends(get_current_user),
):
    att = Attendance(
        employee_id=employee_id, date=date.fromisoformat(att_date),
        check_in=time.fromisoformat(check_in) if check_in else None,
        check_out=time.fromisoformat(check_out) if check_out else None,
        status=status, notes=notes,
    )
    db.add(att)
    db.commit()
    db.refresh(att)
    return att


def _calc_net(basic, total_days, days_worked,
              housing, transport, food, other_allow,
              absence_ded, late_ded, other_ded, advance):
    per_day = basic / total_days if total_days > 0 else 0
    earned_basic = round(per_day * days_worked, 3)
    total_allow = housing + transport + food + other_allow
    total_deduct = absence_ded + late_ded + other_ded
    net = earned_basic + total_allow - total_deduct - advance
    return earned_basic, total_allow, total_deduct, round(net, 3)


# --- Salary Payments ---
@router.get("/salary")
def list_salary_payments(
    month: Optional[str] = None,
    employee_id: Optional[int] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    q = db.query(SalaryPayment)
    if month:
        q = q.filter(SalaryPayment.month == month)
    if employee_id:
        q = q.filter(SalaryPayment.employee_id == employee_id)
    if user.role == "staff" and user.branch_id:
        q = q.filter(SalaryPayment.branch_id == user.branch_id)
    rows = q.order_by(SalaryPayment.month.desc(), SalaryPayment.id).all()
    return [
        {
            "id": r.id, "employee_id": r.employee_id,
            "branch_id": r.branch_id, "month": r.month,
            "basic_salary": r.basic_salary,
            "total_days": r.total_days or 30,
            "days_worked": r.days_worked or 30,
            "housing_allowance": r.housing_allowance or 0,
            "transport_allowance": r.transport_allowance or 0,
            "food_allowance": r.food_allowance or 0,
            "other_allowance": r.other_allowance or 0,
            "allowances": r.allowances,
            "absence_deduction": r.absence_deduction or 0,
            "late_deduction": r.late_deduction or 0,
            "other_deduction": r.other_deduction or 0,
            "deductions": r.deductions,
            "advance": r.advance,
            "net_salary": r.net_salary,
            "payment_method": r.payment_method,
            "status": r.status, "notes": r.notes,
            "paid_date": str(r.paid_date) if r.paid_date else None,
        }
        for r in rows
    ]


@router.post("/salary/generate")
def generate_monthly_payroll(
    month: str = Form(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ("owner", "manager"):
        raise HTTPException(403, "Not authorized")
    # Calculate total days in the month
    year, mon = int(month.split("-")[0]), int(month.split("-")[1])
    total_days = calendar.monthrange(year, mon)[1]

    employees = db.query(Employee).filter(Employee.is_active == True).all()
    created = 0
    for emp in employees:
        exists = db.query(SalaryPayment).filter(
            SalaryPayment.employee_id == emp.id,
            SalaryPayment.month == month,
        ).first()
        if exists:
            continue
        sp = SalaryPayment(
            employee_id=emp.id,
            branch_id=emp.branch_id,
            month=month,
            basic_salary=emp.salary,
            total_days=total_days,
            days_worked=total_days,
            housing_allowance=0, transport_allowance=0,
            food_allowance=0, other_allowance=0,
            allowances=0,
            absence_deduction=0, late_deduction=0, other_deduction=0,
            deductions=0,
            advance=0,
            net_salary=emp.salary,
            status="pending",
        )
        db.add(sp)
        created += 1
    db.commit()
    return {"message": f"Generated {created} salary records for {month}"}


@router.put("/salary/{payment_id}")
def update_salary_payment(
    payment_id: int,
    basic_salary: float = Form(None),
    total_days: int = Form(None),
    days_worked: int = Form(None),
    housing_allowance: float = Form(0),
    transport_allowance: float = Form(0),
    food_allowance: float = Form(0),
    other_allowance: float = Form(0),
    absence_deduction: float = Form(0),
    late_deduction: float = Form(0),
    other_deduction: float = Form(0),
    advance: float = Form(0),
    payment_method: str = Form("cash"),
    notes: str = Form(""),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ("owner", "manager"):
        raise HTTPException(403, "Not authorized")
    sp = db.query(SalaryPayment).filter(SalaryPayment.id == payment_id).first()
    if not sp:
        raise HTTPException(404, "Salary record not found")

    if basic_salary is not None:
        sp.basic_salary = basic_salary
    if total_days is not None:
        sp.total_days = total_days
    if days_worked is not None:
        sp.days_worked = days_worked

    sp.housing_allowance = housing_allowance
    sp.transport_allowance = transport_allowance
    sp.food_allowance = food_allowance
    sp.other_allowance = other_allowance
    sp.absence_deduction = absence_deduction
    sp.late_deduction = late_deduction
    sp.other_deduction = other_deduction
    sp.advance = advance
    sp.payment_method = payment_method
    sp.notes = notes

    earned, total_allow, total_deduct, net = _calc_net(
        sp.basic_salary, sp.total_days, sp.days_worked,
        housing_allowance, transport_allowance, food_allowance, other_allowance,
        absence_deduction, late_deduction, other_deduction, advance,
    )
    sp.allowances = total_allow
    sp.deductions = total_deduct
    sp.net_salary = net

    db.commit()
    return {"message": "Updated"}


@router.post("/salary/{payment_id}/pay")
def mark_salary_paid(
    payment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ("owner", "manager"):
        raise HTTPException(403, "Not authorized")
    sp = db.query(SalaryPayment).filter(SalaryPayment.id == payment_id).first()
    if not sp:
        raise HTTPException(404, "Salary record not found")
    sp.status = "paid"
    sp.paid_date = date.today()
    db.commit()
    return {"message": "Marked as paid"}


@router.delete("/salary/{payment_id}")
def delete_salary_payment(
    payment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ("owner", "manager"):
        raise HTTPException(403, "Not authorized")
    sp = db.query(SalaryPayment).filter(SalaryPayment.id == payment_id).first()
    if not sp:
        raise HTTPException(404, "Salary record not found")
    db.delete(sp)
    db.commit()
    return {"message": "Deleted"}

from fastapi import APIRouter, Depends, Form, HTTPException
from sqlalchemy.orm import Session
from datetime import date, time
from typing import Optional
import calendar

from app.database import get_db
from app.models.hr import Employee, Attendance, SalaryPayment, StaffTransfer, AdvanceLoan, StaffBenefitDeduction
from app.models.user import User
from app.utils.auth import get_current_user

router = APIRouter(prefix="/api/hr", tags=["hr"])

SALARY_VISIBLE_ROLES = ("owner", "manager")


# --- Employees ---
@router.get("/employees")
def list_employees(branch_id: Optional[int] = None, db: Session = Depends(get_db),
                   user: User = Depends(get_current_user)):
    q = db.query(Employee)
    if branch_id:
        q = q.filter(Employee.branch_id == branch_id)
    elif user.role == "staff" and user.branch_id:
        q = q.filter(Employee.branch_id == user.branch_id)
    rows = q.all()
    hide_salary = user.role not in SALARY_VISIBLE_ROLES
    result = []
    for emp in rows:
        d = {
            "id": emp.id, "staff_no": emp.staff_no or "",
            "branch_id": emp.branch_id, "name": emp.name, "name_ar": emp.name_ar or "",
            "civil_id": emp.civil_id or "", "position": emp.position or "",
            "phone": emp.phone or "",
            "salary": 0 if hide_salary else emp.salary,
            "iban": emp.iban or "", "bank_name": emp.bank_name or "",
            "salary_transfer_method": emp.salary_transfer_method or "cash",
            "employer": emp.employer or "mudawwarah",
            "join_date": str(emp.join_date) if emp.join_date else "",
            "is_active": emp.is_active,
        }
        result.append(d)
    return result


@router.post("/employees")
def create_employee(
    branch_id: int = Form(...), name: str = Form(...),
    staff_no: str = Form(""), name_ar: str = Form(""),
    civil_id: str = Form(""), position: str = Form(""),
    phone: str = Form(""), salary: float = Form(0),
    iban: str = Form(""), bank_name: str = Form(""),
    salary_transfer_method: str = Form("cash"),
    employer: str = Form("mudawwarah"),
    join_date: str = Form(""),
    db: Session = Depends(get_db), _=Depends(get_current_user),
):
    emp = Employee(
        branch_id=branch_id, name=name, staff_no=staff_no or None,
        name_ar=name_ar, civil_id=civil_id, position=position, phone=phone,
        salary=salary, iban=iban or None, bank_name=bank_name or None,
        salary_transfer_method=salary_transfer_method, employer=employer,
        join_date=date.fromisoformat(join_date) if join_date else None,
    )
    db.add(emp)
    db.commit()
    db.refresh(emp)
    return emp


@router.put("/employees/{emp_id}")
def update_employee(
    emp_id: int,
    branch_id: int = Form(...), name: str = Form(...),
    staff_no: str = Form(""), name_ar: str = Form(""),
    civil_id: str = Form(""), position: str = Form(""),
    phone: str = Form(""), salary: float = Form(0),
    iban: str = Form(""), bank_name: str = Form(""),
    salary_transfer_method: str = Form("cash"),
    employer: str = Form("mudawwarah"),
    join_date: str = Form(""),
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    if user.role not in SALARY_VISIBLE_ROLES:
        raise HTTPException(403, "Not authorized")
    emp = db.query(Employee).filter(Employee.id == emp_id).first()
    if not emp:
        raise HTTPException(404, "Employee not found")
    emp.branch_id = branch_id
    emp.name = name
    emp.staff_no = staff_no or None
    emp.name_ar = name_ar
    emp.civil_id = civil_id
    emp.position = position
    emp.phone = phone
    emp.salary = salary
    emp.iban = iban or None
    emp.bank_name = bank_name or None
    emp.salary_transfer_method = salary_transfer_method
    emp.employer = employer
    emp.join_date = date.fromisoformat(join_date) if join_date else None
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
              absence_ded, late_ded, other_ded, advance,
              overtime=0, bonus=0, incentive=0, leave_salary=0,
              ticket_payment=0, loan_deduction=0, penalty=0):
    per_day = basic / total_days if total_days > 0 else 0
    earned_basic = round(per_day * days_worked, 3)
    total_allow = housing + transport + food + other_allow
    total_additions = overtime + bonus + incentive + leave_salary + ticket_payment
    total_deduct = absence_ded + late_ded + other_ded + loan_deduction + penalty
    net = earned_basic + total_allow + total_additions - total_deduct - advance
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

    hide_salary = user.role not in SALARY_VISIBLE_ROLES

    # Get employee info for staff_no and position
    emp_ids = list({r.employee_id for r in rows})
    emps = {e.id: e for e in db.query(Employee).filter(Employee.id.in_(emp_ids)).all()} if emp_ids else {}

    return [
        {
            "id": r.id, "employee_id": r.employee_id,
            "staff_no": emps.get(r.employee_id, Employee()).staff_no or "",
            "designation": emps.get(r.employee_id, Employee()).position or "",
            "branch_id": r.branch_id, "month": r.month,
            "basic_salary": 0 if hide_salary else r.basic_salary,
            "total_days": r.total_days or 30,
            "days_worked": r.days_worked or 30,
            "period_start": str(r.period_start) if r.period_start else "",
            "period_end": str(r.period_end) if r.period_end else "",
            "last_workplace": r.last_workplace or "",
            "housing_allowance": 0 if hide_salary else (r.housing_allowance or 0),
            "transport_allowance": 0 if hide_salary else (r.transport_allowance or 0),
            "food_allowance": 0 if hide_salary else (r.food_allowance or 0),
            "other_allowance": 0 if hide_salary else (r.other_allowance or 0),
            "allowances": 0 if hide_salary else r.allowances,
            "overtime": 0 if hide_salary else (r.overtime or 0),
            "bonus": 0 if hide_salary else (r.bonus or 0),
            "incentive": 0 if hide_salary else (r.incentive or 0),
            "leave_salary": 0 if hide_salary else (r.leave_salary or 0),
            "ticket_payment": 0 if hide_salary else (r.ticket_payment or 0),
            "absence_deduction": 0 if hide_salary else (r.absence_deduction or 0),
            "late_deduction": 0 if hide_salary else (r.late_deduction or 0),
            "other_deduction": 0 if hide_salary else (r.other_deduction or 0),
            "loan_deduction": 0 if hide_salary else (r.loan_deduction or 0),
            "penalty": 0 if hide_salary else (r.penalty or 0),
            "deductions": 0 if hide_salary else r.deductions,
            "advance": 0 if hide_salary else r.advance,
            "net_salary": 0 if hide_salary else r.net_salary,
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

        # Auto-calculate loan deduction from active loans with matching deduction_month
        active_loans = db.query(AdvanceLoan).filter(
            AdvanceLoan.employee_id == emp.id,
            AdvanceLoan.status == "active",
            AdvanceLoan.deduction_month == month,
        ).all()
        loan_ded = sum(l.monthly_deduction for l in active_loans)

        sp = SalaryPayment(
            employee_id=emp.id,
            branch_id=emp.branch_id,
            month=month,
            basic_salary=emp.salary,
            total_days=total_days,
            days_worked=total_days,
            period_start=date(year, mon, 1),
            period_end=date(year, mon, total_days),
            last_workplace="",
            housing_allowance=0, transport_allowance=0,
            food_allowance=0, other_allowance=0,
            allowances=0,
            absence_deduction=0, late_deduction=0, other_deduction=0,
            deductions=0,
            advance=0,
            overtime=0, bonus=0, incentive=0, leave_salary=0, ticket_payment=0,
            loan_deduction=loan_ded,
            penalty=0,
            net_salary=emp.salary - loan_ded,
            payment_method=emp.salary_transfer_method or "cash",
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
    period_start: str = Form(""),
    period_end: str = Form(""),
    last_workplace: str = Form(""),
    housing_allowance: float = Form(0),
    transport_allowance: float = Form(0),
    food_allowance: float = Form(0),
    other_allowance: float = Form(0),
    absence_deduction: float = Form(0),
    late_deduction: float = Form(0),
    other_deduction: float = Form(0),
    advance: float = Form(0),
    overtime: float = Form(0),
    bonus: float = Form(0),
    incentive: float = Form(0),
    leave_salary: float = Form(0),
    ticket_payment: float = Form(0),
    loan_deduction: float = Form(0),
    penalty: float = Form(0),
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

    sp.period_start = date.fromisoformat(period_start) if period_start else None
    sp.period_end = date.fromisoformat(period_end) if period_end else None
    sp.last_workplace = last_workplace or None
    sp.housing_allowance = housing_allowance
    sp.transport_allowance = transport_allowance
    sp.food_allowance = food_allowance
    sp.other_allowance = other_allowance
    sp.absence_deduction = absence_deduction
    sp.late_deduction = late_deduction
    sp.other_deduction = other_deduction
    sp.advance = advance
    sp.overtime = overtime
    sp.bonus = bonus
    sp.incentive = incentive
    sp.leave_salary = leave_salary
    sp.ticket_payment = ticket_payment
    sp.loan_deduction = loan_deduction
    sp.penalty = penalty
    sp.payment_method = payment_method
    sp.notes = notes

    earned, total_allow, total_deduct, net = _calc_net(
        sp.basic_salary, sp.total_days, sp.days_worked,
        housing_allowance, transport_allowance, food_allowance, other_allowance,
        absence_deduction, late_deduction, other_deduction, advance,
        overtime, bonus, incentive, leave_salary, ticket_payment,
        loan_deduction, penalty,
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

    # Deduct loan balances
    if sp.loan_deduction and sp.loan_deduction > 0:
        active_loans = db.query(AdvanceLoan).filter(
            AdvanceLoan.employee_id == sp.employee_id,
            AdvanceLoan.status == "active",
        ).all()
        remaining = sp.loan_deduction
        for loan in active_loans:
            if remaining <= 0:
                break
            deduct = min(remaining, loan.balance)
            loan.balance = round(loan.balance - deduct, 3)
            if loan.balance <= 0:
                loan.status = "paid_off"
            remaining -= deduct

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


# --- Staff Transfers ---
@router.get("/transfers")
def list_transfers(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return db.query(StaffTransfer).order_by(StaffTransfer.created_at.desc()).all()


@router.post("/transfers")
def create_transfer(
    employee_id: int = Form(...),
    from_branch_id: int = Form(...),
    to_branch_id: int = Form(...),
    transfer_date: str = Form(...),
    notes: str = Form(""),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    t = StaffTransfer(
        employee_id=employee_id,
        from_branch_id=from_branch_id,
        to_branch_id=to_branch_id,
        transfer_date=date.fromisoformat(transfer_date),
        requested_by=user.id,
        notes=notes,
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


@router.post("/transfers/{transfer_id}/approve")
def approve_transfer(
    transfer_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ("owner", "manager"):
        raise HTTPException(403, "Not authorized")
    t = db.query(StaffTransfer).filter(StaffTransfer.id == transfer_id).first()
    if not t:
        raise HTTPException(404, "Transfer not found")
    t.status = "approved"
    t.approved_by = user.id
    # Update employee branch
    emp = db.query(Employee).filter(Employee.id == t.employee_id).first()
    if emp:
        emp.branch_id = t.to_branch_id
    db.commit()
    return {"message": "Transfer approved"}


@router.post("/transfers/{transfer_id}/reject")
def reject_transfer(
    transfer_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ("owner", "manager"):
        raise HTTPException(403, "Not authorized")
    t = db.query(StaffTransfer).filter(StaffTransfer.id == transfer_id).first()
    if not t:
        raise HTTPException(404, "Transfer not found")
    t.status = "rejected"
    t.approved_by = user.id
    db.commit()
    return {"message": "Transfer rejected"}


# --- Advance / Loan ---
@router.get("/loans")
def list_loans(employee_id: Optional[int] = None, db: Session = Depends(get_db),
               _=Depends(get_current_user)):
    q = db.query(AdvanceLoan)
    if employee_id:
        q = q.filter(AdvanceLoan.employee_id == employee_id)
    return q.order_by(AdvanceLoan.created_at.desc()).all()


@router.post("/loans")
def create_loan(
    employee_id: int = Form(...),
    loan_type: str = Form("advance"),
    amount: float = Form(...),
    monthly_deduction: float = Form(0),
    deduction_month: str = Form(""),
    loan_date: str = Form(...),
    notes: str = Form(""),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ("owner", "manager"):
        raise HTTPException(403, "Not authorized")
    loan = AdvanceLoan(
        employee_id=employee_id,
        loan_type=loan_type,
        amount=amount,
        balance=amount,
        monthly_deduction=monthly_deduction,
        deduction_month=deduction_month or None,
        date=date.fromisoformat(loan_date),
        notes=notes,
    )
    db.add(loan)
    db.commit()
    db.refresh(loan)
    return loan


# --- Benefits & Deductions ---
@router.get("/benefits-deductions")
def list_benefits_deductions(employee_id: Optional[int] = None, month: Optional[str] = None,
                             db: Session = Depends(get_db), _=Depends(get_current_user)):
    q = db.query(StaffBenefitDeduction)
    if employee_id:
        q = q.filter(StaffBenefitDeduction.employee_id == employee_id)
    if month:
        q = q.filter(StaffBenefitDeduction.month == month)
    return q.order_by(StaffBenefitDeduction.created_at.desc()).all()


@router.post("/benefits-deductions")
def create_benefit_deduction(
    employee_id: int = Form(...),
    category: str = Form(...),
    amount: float = Form(...),
    bd_date: str = Form(...),
    month: str = Form(""),
    notes: str = Form(""),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ("owner", "manager"):
        raise HTTPException(403, "Not authorized")
    bd = StaffBenefitDeduction(
        employee_id=employee_id,
        category=category,
        amount=amount,
        date=date.fromisoformat(bd_date),
        month=month or None,
        notes=notes,
    )
    db.add(bd)
    db.commit()
    db.refresh(bd)
    return bd

from fastapi import APIRouter, Depends, Form, HTTPException
from sqlalchemy.orm import Session
from datetime import date, time
from typing import Optional
import calendar

from app.database import get_db
from app.models.hr import Brand, Employee, Attendance, SalaryPayment, StaffTransfer, AdvanceLoan, StaffBenefitDeduction, LeaveRecord, Resignation, Contract
from app.models.branch import Branch
from app.models.user import User
from app.utils.auth import get_current_user

router = APIRouter(prefix="/api/hr", tags=["hr"])

SALARY_VISIBLE_ROLES = ("owner", "manager", "accountant")


def _brand_branch_ids(db: Session, brand_id: Optional[int]) -> Optional[list]:
    """Return list of branch IDs for a brand, or None if no filter."""
    if not brand_id:
        return None
    ids = [b.id for b in db.query(Branch).filter(Branch.brand_id == brand_id).all()]
    return ids


# --- Brands ---
@router.get("/brands")
def list_brands(db: Session = Depends(get_db), _=Depends(get_current_user)):
    rows = db.query(Brand).order_by(Brand.id).all()
    return [{"id": b.id, "name_en": b.name_en, "name_ar": b.name_ar or "",
             "status": b.status or "active"} for b in rows]


@router.post("/brands")
def create_brand(
    name_en: str = Form(...), name_ar: str = Form(""),
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    if user.role != "owner":
        raise HTTPException(403, "Only owner can create brands")
    existing = db.query(Brand).filter(Brand.name_en == name_en).first()
    if existing:
        raise HTTPException(400, f"Brand '{name_en}' already exists")
    b = Brand(name_en=name_en, name_ar=name_ar or None)
    db.add(b)
    db.commit()
    db.refresh(b)
    return {"id": b.id, "name_en": b.name_en, "name_ar": b.name_ar or "", "status": b.status}


@router.put("/brands/{brand_id}")
def update_brand(
    brand_id: int,
    name_en: str = Form(...), name_ar: str = Form(""),
    status: str = Form("active"),
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    if user.role != "owner":
        raise HTTPException(403, "Only owner can edit brands")
    b = db.query(Brand).filter(Brand.id == brand_id).first()
    if not b:
        raise HTTPException(404, "Brand not found")
    b.name_en = name_en
    b.name_ar = name_ar or None
    b.status = status
    db.commit()
    return {"id": b.id, "name_en": b.name_en, "name_ar": b.name_ar or "", "status": b.status}


@router.delete("/brands/{brand_id}")
def delete_brand(brand_id: int, db: Session = Depends(get_db),
                 user: User = Depends(get_current_user)):
    if user.role != "owner":
        raise HTTPException(403, "Only owner can delete brands")
    b = db.query(Brand).filter(Brand.id == brand_id).first()
    if not b:
        raise HTTPException(404, "Brand not found")
    # Check no branches assigned
    branch_count = db.query(Branch).filter(Branch.brand_id == brand_id).count()
    if branch_count > 0:
        raise HTTPException(400, "Cannot delete brand with assigned branches")
    db.delete(b)
    db.commit()
    return {"ok": True}


# --- Employees ---
@router.get("/employees")
def list_employees(branch_id: Optional[int] = None, brand_id: Optional[int] = None,
                   db: Session = Depends(get_db),
                   user: User = Depends(get_current_user)):
    q = db.query(Employee)
    bb_ids = _brand_branch_ids(db, brand_id)
    if branch_id:
        q = q.filter(Employee.branch_id == branch_id)
    elif bb_ids is not None:
        q = q.filter(Employee.branch_id.in_(bb_ids))
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
            "work_permit_salary": 0 if hide_salary else (emp.work_permit_salary or 0),
            "actual_salary": 0 if hide_salary else (emp.actual_salary or 0),
            "iban": emp.iban or "", "bank_name": emp.bank_name or "",
            "salary_transfer_method": emp.salary_transfer_method or "cash",
            "employer": emp.employer or "",
            "join_date": str(emp.join_date) if emp.join_date else "",
            "termination_date": str(emp.termination_date) if emp.termination_date else "",
            "last_working_date": str(emp.last_working_date) if emp.last_working_date else "",
            "residency_expiry": str(emp.residency_expiry) if emp.residency_expiry else "",
            "health_card_expiry": str(emp.health_card_expiry) if emp.health_card_expiry else "",
            "is_active": emp.is_active,
        }
        result.append(d)
    return result


@router.get("/employers")
def list_employers(db: Session = Depends(get_db), _=Depends(get_current_user)):
    """Return unique employer names for dropdown (no duplicates)."""
    rows = db.query(Employee.employer).filter(Employee.employer != None, Employee.employer != "").distinct().all()
    return sorted(set(r[0] for r in rows if r[0]))


@router.post("/employees")
def create_employee(
    branch_id: int = Form(...), name: str = Form(...),
    staff_no: str = Form(""), name_ar: str = Form(""),
    civil_id: str = Form(""), position: str = Form(""),
    phone: str = Form(""), salary: float = Form(0),
    work_permit_salary: float = Form(0),
    actual_salary: float = Form(0),
    iban: str = Form(""), bank_name: str = Form(""),
    salary_transfer_method: str = Form("cash"),
    employer: str = Form(""),
    join_date: str = Form(""),
    termination_date: str = Form(""),
    last_working_date: str = Form(""),
    residency_expiry: str = Form(""),
    health_card_expiry: str = Form(""),
    db: Session = Depends(get_db), _=Depends(get_current_user),
):
    # Duplicate Civil ID check
    if civil_id and civil_id.strip():
        existing = db.query(Employee).filter(Employee.civil_id == civil_id.strip()).first()
        if existing:
            raise HTTPException(400, f"Employee with Civil ID {civil_id} already exists")
    # Auto-generate staff_no
    max_no = db.query(Employee).count()
    generated_staff_no = f"EMP-{max_no + 1:04d}"
    emp = Employee(
        branch_id=branch_id, name=name, staff_no=generated_staff_no,
        name_ar=name_ar, civil_id=civil_id, position=position, phone=phone,
        salary=salary, work_permit_salary=work_permit_salary,
        actual_salary=actual_salary,
        iban=iban or None, bank_name=bank_name or None,
        salary_transfer_method=salary_transfer_method, employer=employer or None,
        join_date=date.fromisoformat(join_date) if join_date else None,
        termination_date=date.fromisoformat(termination_date) if termination_date else None,
        last_working_date=date.fromisoformat(last_working_date) if last_working_date else None,
        residency_expiry=date.fromisoformat(residency_expiry) if residency_expiry else None,
        health_card_expiry=date.fromisoformat(health_card_expiry) if health_card_expiry else None,
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
    work_permit_salary: float = Form(0),
    actual_salary: float = Form(0),
    iban: str = Form(""), bank_name: str = Form(""),
    salary_transfer_method: str = Form("cash"),
    employer: str = Form(""),
    join_date: str = Form(""),
    termination_date: str = Form(""),
    last_working_date: str = Form(""),
    residency_expiry: str = Form(""),
    health_card_expiry: str = Form(""),
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    if user.role not in SALARY_VISIBLE_ROLES:
        raise HTTPException(403, "Not authorized")
    emp = db.query(Employee).filter(Employee.id == emp_id).first()
    if not emp:
        raise HTTPException(404, "Employee not found")
    # Duplicate Civil ID check (exclude self)
    if civil_id and civil_id.strip():
        existing = db.query(Employee).filter(Employee.civil_id == civil_id.strip(), Employee.id != emp_id).first()
        if existing:
            raise HTTPException(400, f"Employee with Civil ID {civil_id} already exists")
    emp.branch_id = branch_id
    emp.name = name
    emp.staff_no = staff_no or emp.staff_no
    emp.name_ar = name_ar
    emp.civil_id = civil_id
    emp.position = position
    emp.phone = phone
    emp.salary = salary
    emp.work_permit_salary = work_permit_salary
    emp.actual_salary = actual_salary
    emp.iban = iban or None
    emp.bank_name = bank_name or None
    emp.salary_transfer_method = salary_transfer_method
    emp.employer = employer or None
    emp.join_date = date.fromisoformat(join_date) if join_date else None
    emp.termination_date = date.fromisoformat(termination_date) if termination_date else None
    emp.last_working_date = date.fromisoformat(last_working_date) if last_working_date else None
    emp.residency_expiry = date.fromisoformat(residency_expiry) if residency_expiry else None
    emp.health_card_expiry = date.fromisoformat(health_card_expiry) if health_card_expiry else None
    db.commit()
    db.refresh(emp)
    return emp


@router.delete("/employees/{emp_id}")
def delete_employee(
    emp_id: int,
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    if user.role not in ("owner",):
        raise HTTPException(403, "Not authorized")
    emp = db.query(Employee).filter(Employee.id == emp_id).first()
    if not emp:
        raise HTTPException(404, "Employee not found")
    db.delete(emp)
    db.commit()
    return {"message": "Deleted"}


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
    status: str = Form("absent"), notes: str = Form(""),
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
    brand_id: Optional[int] = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in SALARY_VISIBLE_ROLES:
        raise HTTPException(status_code=403, detail="Not authorized to view salary data")
    q = db.query(SalaryPayment)
    if month:
        q = q.filter(SalaryPayment.month == month)
    if employee_id:
        q = q.filter(SalaryPayment.employee_id == employee_id)
    bb_ids = _brand_branch_ids(db, brand_id)
    if bb_ids is not None:
        q = q.filter(SalaryPayment.branch_id.in_(bb_ids))
    rows = q.order_by(SalaryPayment.month.desc(), SalaryPayment.id).all()

    hide_salary = False

    # Get employee info for staff_no and position
    emp_ids = list({r.employee_id for r in rows})
    emps = {e.id: e for e in db.query(Employee).filter(Employee.id.in_(emp_ids)).all()} if emp_ids else {}

    # Filter out records for employees with 0 actual salary
    rows = [r for r in rows if (emps.get(r.employee_id) and (emps[r.employee_id].actual_salary or 0) > 0)]

    return [
        {
            "id": r.id, "employee_id": r.employee_id,
            "staff_no": emps.get(r.employee_id, Employee()).staff_no or "",
            "name": emps.get(r.employee_id, Employee()).name or "",
            "name_ar": emps.get(r.employee_id, Employee()).name_ar or "",
            "designation": emps.get(r.employee_id, Employee()).position or "",
            "current_actual_salary": emps.get(r.employee_id, Employee()).actual_salary or 0,
            "branch_id": emps[r.employee_id].branch_id if emps.get(r.employee_id) else r.branch_id, "month": r.month,
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
    brand_id: Optional[int] = Form(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ("owner", "manager"):
        raise HTTPException(403, "Not authorized")
    year, mon = int(month.split("-")[0]), int(month.split("-")[1])
    last_day = calendar.monthrange(year, mon)[1]
    # Default to full month
    p_start = date(year, mon, 1)
    p_end = date(year, mon, last_day)
    total_days = 30  # salary basis always 30
    period_working_days = 30

    eq = db.query(Employee).filter(
        Employee.is_active == True,
        Employee.actual_salary > 0,
    )
    bb_ids = _brand_branch_ids(db, brand_id)
    if bb_ids is not None:
        eq = eq.filter(Employee.branch_id.in_(bb_ids))
    employees = eq.all()

    # Clean up old pending salary records for employees with 0 actual salary
    zero_salary_emps = db.query(Employee).filter(
        (Employee.actual_salary == None) | (Employee.actual_salary == 0)
    ).all()
    zero_ids = [e.id for e in zero_salary_emps]
    if zero_ids:
        db.query(SalaryPayment).filter(
            SalaryPayment.month == month,
            SalaryPayment.employee_id.in_(zero_ids),
            SalaryPayment.status == "pending",
        ).delete(synchronize_session=False)

    created = 0
    updated = 0
    for emp in employees:
        existing = db.query(SalaryPayment).filter(
            SalaryPayment.employee_id == emp.id,
            SalaryPayment.month == month,
        ).first()
        # Skip already-paid or on-hold records
        if existing and existing.status in ("paid", "on_hold"):
            continue

        # If employee has a last_working_date in this month, cap the period
        emp_period_end = p_end
        emp_period_days = period_working_days
        if emp.last_working_date and p_start <= emp.last_working_date <= p_end:
            emp_period_end = emp.last_working_date
            emp_period_days = (emp.last_working_date - p_start).days + 1
            emp_period_days = min(max(emp_period_days, 0), 30)

        # Auto-calculate leave/absence days for this month
        leave_recs = db.query(LeaveRecord).filter(
            LeaveRecord.employee_id == emp.id,
            LeaveRecord.month == month,
        ).all()
        unpaid_absence_days = sum(lr.days for lr in leave_recs if not lr.is_paid)
        paid_leave_days = sum(lr.days for lr in leave_recs if lr.is_paid)
        total_leave_days = unpaid_absence_days + paid_leave_days
        actual_days_worked = max(0, emp_period_days - total_leave_days)

        # Absence deduction (only for unpaid leaves)
        per_day = emp.actual_salary / total_days if total_days > 0 else 0
        absence_ded = round(per_day * unpaid_absence_days, 3)

        # Pro-rate salary based on actual period days
        prorated_salary = round(per_day * emp_period_days, 3)

        # Auto-calculate loan deduction from active loans with matching deduction_month
        active_loans = db.query(AdvanceLoan).filter(
            AdvanceLoan.employee_id == emp.id,
            AdvanceLoan.status == "active",
            AdvanceLoan.deduction_month == month,
        ).all()
        loan_ded = sum(l.monthly_deduction for l in active_loans)

        # Auto-calculate benefits from StaffBenefitDeduction for this month
        ben_deds = db.query(StaffBenefitDeduction).filter(
            StaffBenefitDeduction.employee_id == emp.id,
            StaffBenefitDeduction.month == month,
        ).all()
        incentive_total = sum(b.amount for b in ben_deds if b.category == "incentive")
        bonus_total = sum(b.amount for b in ben_deds if b.category == "bonus")
        leave_salary_total = sum(b.amount for b in ben_deds if b.category == "leave_salary")
        ticket_total = sum(b.amount for b in ben_deds if b.category == "ticket")
        overtime_total = sum(b.amount for b in ben_deds if b.category == "overtime")
        other_benefit_total = sum(b.amount for b in ben_deds if b.category == "other_benefit")

        # Auto-calculate deductions from StaffBenefitDeduction for this month
        penalty_total = sum(b.amount for b in ben_deds if b.category in ("fine", "penalty"))
        other_ded_total = sum(b.amount for b in ben_deds if b.category == "other_deduction")

        # sp.allowances = fixed allowances (other_benefit goes into other_allowance)
        fixed_allowances = other_benefit_total
        total_additions = incentive_total + bonus_total + leave_salary_total + ticket_total + overtime_total
        fixed_deductions = absence_ded + other_ded_total  # exclude loan_ded and penalty (stored separately)
        net = prorated_salary + fixed_allowances + total_additions - fixed_deductions - loan_ded - penalty_total

        if existing:
            # Update existing pending record with latest calculations
            sp = existing
            sp.branch_id = emp.branch_id
            sp.basic_salary = emp.actual_salary
            sp.total_days = total_days
            # Preserve custom period dates if already set by user edit
            if sp.period_start and sp.period_end and (sp.period_start != p_start or sp.period_end != emp_period_end):
                custom_days = (sp.period_end - sp.period_start).days + 1
                custom_working_days = min(max(custom_days, 0), 30)
                sp.days_worked = max(0, custom_working_days - total_leave_days)
                prorated_salary = round(per_day * custom_working_days, 3)
                net = prorated_salary + fixed_allowances + total_additions - fixed_deductions - loan_ded - penalty_total
            else:
                sp.days_worked = actual_days_worked
                sp.period_start = p_start
                sp.period_end = emp_period_end
            sp.other_allowance = other_benefit_total
            sp.allowances = fixed_allowances
            sp.absence_deduction = absence_ded
            sp.other_deduction = other_ded_total
            sp.deductions = fixed_deductions
            sp.overtime = overtime_total
            sp.bonus = bonus_total
            sp.incentive = incentive_total
            sp.leave_salary = leave_salary_total
            sp.ticket_payment = ticket_total
            sp.loan_deduction = loan_ded
            sp.penalty = penalty_total
            sp.net_salary = net
            sp.payment_method = emp.salary_transfer_method or "cash"
            updated += 1
        else:
            sp = SalaryPayment(
                employee_id=emp.id,
                branch_id=emp.branch_id,
                month=month,
                basic_salary=emp.actual_salary,
                total_days=total_days,
                days_worked=actual_days_worked,
                period_start=p_start,
                period_end=emp_period_end,
                last_workplace="",
                housing_allowance=0, transport_allowance=0,
                food_allowance=0, other_allowance=other_benefit_total,
                allowances=fixed_allowances,
                absence_deduction=absence_ded, late_deduction=0,
                other_deduction=other_ded_total,
                deductions=fixed_deductions,
                advance=0,
                overtime=overtime_total,
                bonus=bonus_total,
                incentive=incentive_total,
                leave_salary=leave_salary_total,
                ticket_payment=ticket_total,
                loan_deduction=loan_ded,
                penalty=penalty_total,
                net_salary=net,
                payment_method=emp.salary_transfer_method or "cash",
                status="pending",
            )
            db.add(sp)
            created += 1
    db.commit()
    return {"message": f"Generated {created} new, updated {updated} existing salary records for {month}"}


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

    sp.period_start = date.fromisoformat(period_start) if period_start else None
    sp.period_end = date.fromisoformat(period_end) if period_end else None

    # Auto-calculate days_worked from period dates if both are provided
    if sp.period_start and sp.period_end:
        calendar_days = (sp.period_end - sp.period_start).days + 1
        sp.days_worked = min(max(calendar_days, 0), 30)
    elif days_worked is not None:
        sp.days_worked = days_worked
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


@router.get("/salary/{payment_id}/payslip")
def get_payslip(
    payment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in SALARY_VISIBLE_ROLES:
        raise HTTPException(403, "Not authorized")
    sp = db.query(SalaryPayment).filter(SalaryPayment.id == payment_id).first()
    if not sp:
        raise HTTPException(404, "Salary record not found")
    emp = db.query(Employee).filter(Employee.id == sp.employee_id).first()
    branch = db.query(Branch).filter(Branch.id == sp.branch_id).first()
    return {
        "id": sp.id,
        "month": sp.month,
        "employee": {
            "id": emp.id if emp else 0,
            "staff_no": emp.staff_no if emp else "",
            "name": emp.name if emp else "",
            "position": emp.position if emp else "",
            "civil_id": emp.civil_id if emp else "",
            "iban": emp.iban if emp else "",
            "bank_name": emp.bank_name if emp else "",
            "branch": branch.name if branch else "",
            "join_date": str(emp.join_date) if emp and emp.join_date else "",
        },
        "basic_salary": sp.basic_salary,
        "total_days": sp.total_days or 30,
        "days_worked": sp.days_worked or 30,
        "period_start": str(sp.period_start) if sp.period_start else "",
        "period_end": str(sp.period_end) if sp.period_end else "",
        "last_workplace": sp.last_workplace or "",
        "housing_allowance": sp.housing_allowance or 0,
        "transport_allowance": sp.transport_allowance or 0,
        "food_allowance": sp.food_allowance or 0,
        "other_allowance": sp.other_allowance or 0,
        "allowances": sp.allowances or 0,
        "overtime": sp.overtime or 0,
        "bonus": sp.bonus or 0,
        "incentive": sp.incentive or 0,
        "leave_salary": sp.leave_salary or 0,
        "ticket_payment": sp.ticket_payment or 0,
        "absence_deduction": sp.absence_deduction or 0,
        "late_deduction": sp.late_deduction or 0,
        "other_deduction": sp.other_deduction or 0,
        "loan_deduction": sp.loan_deduction or 0,
        "penalty": sp.penalty or 0,
        "deductions": sp.deductions or 0,
        "advance": sp.advance or 0,
        "net_salary": sp.net_salary or 0,
        "payment_method": sp.payment_method,
        "status": sp.status,
        "paid_date": str(sp.paid_date) if sp.paid_date else None,
    }


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


@router.post("/salary/{payment_id}/hold")
def hold_salary(
    payment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ("owner", "manager"):
        raise HTTPException(403, "Not authorized")
    sp = db.query(SalaryPayment).filter(SalaryPayment.id == payment_id).first()
    if not sp:
        raise HTTPException(404, "Salary record not found")
    if sp.status == "paid":
        raise HTTPException(400, "Cannot hold a paid salary")
    sp.status = "on_hold"
    db.commit()
    return {"message": "Salary on hold"}


@router.post("/salary/{payment_id}/release")
def release_salary(
    payment_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ("owner", "manager"):
        raise HTTPException(403, "Not authorized")
    sp = db.query(SalaryPayment).filter(SalaryPayment.id == payment_id).first()
    if not sp:
        raise HTTPException(404, "Salary record not found")
    if sp.status != "on_hold":
        raise HTTPException(400, "Salary is not on hold")
    sp.status = "pending"
    db.commit()
    return {"message": "Salary released"}


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
def list_transfers(brand_id: Optional[int] = None, db: Session = Depends(get_db), _=Depends(get_current_user)):
    q = db.query(StaffTransfer)
    bb_ids = _brand_branch_ids(db, brand_id)
    if bb_ids is not None:
        q = q.filter(StaffTransfer.from_branch_id.in_(bb_ids))
    return q.order_by(StaffTransfer.created_at.desc()).all()


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
def list_loans(employee_id: Optional[int] = None, brand_id: Optional[int] = None,
               db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role not in SALARY_VISIBLE_ROLES:
        raise HTTPException(403, "Not authorized")
    q = db.query(AdvanceLoan)
    if employee_id:
        q = q.filter(AdvanceLoan.employee_id == employee_id)
    elif brand_id:
        bb_ids = _brand_branch_ids(db, brand_id)
        if bb_ids is not None:
            emp_ids = [e.id for e in db.query(Employee.id).filter(Employee.branch_id.in_(bb_ids)).all()]
            q = q.filter(AdvanceLoan.employee_id.in_(emp_ids)) if emp_ids else q.filter(False)
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


@router.put("/loans/{loan_id}")
def update_loan(
    loan_id: int,
    employee_id: int = Form(...),
    loan_type: str = Form("advance"),
    amount: float = Form(...),
    balance: float = Form(...),
    monthly_deduction: float = Form(0),
    deduction_month: str = Form(""),
    loan_date: str = Form(...),
    notes: str = Form(""),
    status: str = Form("active"),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ("owner", "manager"):
        raise HTTPException(403, "Not authorized")
    loan = db.query(AdvanceLoan).filter(AdvanceLoan.id == loan_id).first()
    if not loan:
        raise HTTPException(404, "Loan not found")
    loan.employee_id = employee_id
    loan.loan_type = loan_type
    loan.amount = amount
    loan.balance = balance
    loan.monthly_deduction = monthly_deduction
    loan.deduction_month = deduction_month or None
    loan.date = date.fromisoformat(loan_date)
    loan.notes = notes
    loan.status = status
    db.commit()
    return {"message": "Updated"}


@router.delete("/loans/{loan_id}")
def delete_loan(loan_id: int, db: Session = Depends(get_db),
                user: User = Depends(get_current_user)):
    if user.role not in ("owner", "manager"):
        raise HTTPException(403, "Not authorized")
    loan = db.query(AdvanceLoan).filter(AdvanceLoan.id == loan_id).first()
    if not loan:
        raise HTTPException(404, "Loan not found")
    db.delete(loan)
    db.commit()
    return {"message": "Deleted"}


# --- Benefits & Deductions ---
@router.get("/benefits-deductions")
def list_benefits_deductions(employee_id: Optional[int] = None, month: Optional[str] = None,
                             brand_id: Optional[int] = None,
                             db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role not in SALARY_VISIBLE_ROLES:
        raise HTTPException(403, "Not authorized")
    q = db.query(StaffBenefitDeduction)
    if employee_id:
        q = q.filter(StaffBenefitDeduction.employee_id == employee_id)
    if month:
        q = q.filter(StaffBenefitDeduction.month == month)
    if brand_id and not employee_id:
        bb_ids = _brand_branch_ids(db, brand_id)
        if bb_ids is not None:
            emp_ids = [e.id for e in db.query(Employee.id).filter(Employee.branch_id.in_(bb_ids)).all()]
            q = q.filter(StaffBenefitDeduction.employee_id.in_(emp_ids)) if emp_ids else q.filter(False)
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


@router.put("/benefits-deductions/{bd_id}")
def update_benefit_deduction(
    bd_id: int,
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
    bd = db.query(StaffBenefitDeduction).filter(StaffBenefitDeduction.id == bd_id).first()
    if not bd:
        raise HTTPException(404, "Record not found")
    bd.employee_id = employee_id
    bd.category = category
    bd.amount = amount
    bd.date = date.fromisoformat(bd_date)
    bd.month = month or None
    bd.notes = notes
    db.commit()
    return {"message": "Updated"}


@router.delete("/benefits-deductions/{bd_id}")
def delete_benefit_deduction(bd_id: int, db: Session = Depends(get_db),
                             user: User = Depends(get_current_user)):
    if user.role not in ("owner", "manager"):
        raise HTTPException(403, "Not authorized")
    bd = db.query(StaffBenefitDeduction).filter(StaffBenefitDeduction.id == bd_id).first()
    if not bd:
        raise HTTPException(404, "Record not found")
    db.delete(bd)
    db.commit()
    return {"message": "Deleted"}


# --- Leave / Absence Records ---
@router.get("/leaves")
def list_leaves(employee_id: Optional[int] = None, month: Optional[str] = None,
                brand_id: Optional[int] = None,
                db: Session = Depends(get_db), _=Depends(get_current_user)):
    q = db.query(LeaveRecord)
    if employee_id:
        q = q.filter(LeaveRecord.employee_id == employee_id)
    if month:
        q = q.filter(LeaveRecord.month == month)
    if brand_id and not employee_id:
        bb_ids = _brand_branch_ids(db, brand_id)
        if bb_ids is not None:
            emp_ids = [e.id for e in db.query(Employee.id).filter(Employee.branch_id.in_(bb_ids)).all()]
            q = q.filter(LeaveRecord.employee_id.in_(emp_ids)) if emp_ids else q.filter(False)
    rows = q.order_by(LeaveRecord.start_date.desc()).all()
    return [
        {
            "id": r.id, "employee_id": r.employee_id,
            "leave_type": r.leave_type, "start_date": str(r.start_date),
            "end_date": str(r.end_date), "days": r.days,
            "is_paid": r.is_paid, "month": r.month or "",
            "notes": r.notes or "",
        }
        for r in rows
    ]


@router.post("/leaves")
def create_leave(
    employee_id: int = Form(...),
    leave_type: str = Form(...),
    start_date: str = Form(...),
    end_date: str = Form(...),
    is_paid: bool = Form(False),
    month: str = Form(""),
    notes: str = Form(""),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ("owner", "manager"):
        raise HTTPException(403, "Not authorized")
    sd = date.fromisoformat(start_date)
    ed = date.fromisoformat(end_date)
    days = (ed - sd).days + 1
    if days < 1:
        raise HTTPException(400, "End date must be after start date")
    rec = LeaveRecord(
        employee_id=employee_id,
        leave_type=leave_type,
        start_date=sd,
        end_date=ed,
        days=days,
        is_paid=is_paid,
        month=month or None,
        notes=notes,
    )
    db.add(rec)
    db.commit()
    db.refresh(rec)
    return {"id": rec.id, "days": rec.days, "message": f"Leave recorded: {days} days"}


@router.put("/leaves/{leave_id}")
def update_leave(
    leave_id: int,
    employee_id: int = Form(...),
    leave_type: str = Form(...),
    start_date: str = Form(...),
    end_date: str = Form(...),
    is_paid: bool = Form(False),
    month: str = Form(""),
    notes: str = Form(""),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    if user.role not in ("owner", "manager"):
        raise HTTPException(403, "Not authorized")
    rec = db.query(LeaveRecord).filter(LeaveRecord.id == leave_id).first()
    if not rec:
        raise HTTPException(404, "Leave record not found")
    sd = date.fromisoformat(start_date)
    ed = date.fromisoformat(end_date)
    days = (ed - sd).days + 1
    if days < 1:
        raise HTTPException(400, "End date must be after start date")
    rec.employee_id = employee_id
    rec.leave_type = leave_type
    rec.start_date = sd
    rec.end_date = ed
    rec.days = days
    rec.is_paid = is_paid
    rec.month = month or None
    rec.notes = notes
    db.commit()
    return {"message": "Updated"}


@router.delete("/leaves/{leave_id}")
def delete_leave(leave_id: int, db: Session = Depends(get_db),
                 user: User = Depends(get_current_user)):
    if user.role not in ("owner", "manager"):
        raise HTTPException(403, "Not authorized")
    rec = db.query(LeaveRecord).filter(LeaveRecord.id == leave_id).first()
    if not rec:
        raise HTTPException(404, "Leave record not found")
    db.delete(rec)
    db.commit()
    return {"message": "Deleted"}


# --- Resignations ---
def _resignation_to_dict(r):
    return {
        "id": r.id, "ref_no": r.ref_no or "", "employee_id": r.employee_id,
        "name_en": r.name_en or "", "name_ar": r.name_ar or "",
        "civil_id": r.civil_id or "", "nationality": r.nationality or "",
        "job_title": r.job_title or "", "department_branch": r.department_branch or "",
        "date_of_joining": str(r.date_of_joining) if r.date_of_joining else "",
        "last_working_day": str(r.last_working_day) if r.last_working_day else "",
        "mobile": r.mobile or "", "email": r.email or "",
        "reason": r.reason or "", "resignation_date": str(r.resignation_date) if r.resignation_date else "",
        "company_id_returned": r.company_id_returned, "uniform_returned": r.uniform_returned,
        "locker_keys_handed": r.locker_keys_handed, "equipment_returned": r.equipment_returned,
        "loans_cleared": r.loans_cleared, "handover_completed": r.handover_completed,
        "final_settlement_calculated": r.final_settlement_calculated,
        "final_salary_paid": r.final_salary_paid,
        "ops_manager_name": r.ops_manager_name or "", "ops_manager_status": r.ops_manager_status or "pending",
        "ops_manager_date": str(r.ops_manager_date) if r.ops_manager_date else "",
        "gm_name": r.gm_name or "", "gm_status": r.gm_status or "pending",
        "gm_date": str(r.gm_date) if r.gm_date else "",
        "finance_manager_name": r.finance_manager_name or "",
        "last_salary_paid_amount": r.last_salary_paid_amount or 0,
        "end_of_service": r.end_of_service or 0,
        "leave_encashment": r.leave_encashment or 0,
        "deductions_amount": r.deductions_amount or 0,
        "final_settlement_amount": r.final_settlement_amount or 0,
        "finance_date": str(r.finance_date) if r.finance_date else "",
        "dues_cleared_consent": r.dues_cleared_consent if r.dues_cleared_consent else False,
        "consent_date": str(r.consent_date) if r.consent_date else "",
        "status": r.status or "draft",
        "created_at": str(r.created_at) if r.created_at else "",
    }


@router.get("/resignations")
def list_resignations(brand_id: Optional[int] = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role not in SALARY_VISIBLE_ROLES:
        raise HTTPException(403, "Not authorized")
    q = db.query(Resignation)
    if brand_id:
        bb_ids = _brand_branch_ids(db, brand_id)
        if bb_ids is not None:
            emp_ids = [e.id for e in db.query(Employee.id).filter(Employee.branch_id.in_(bb_ids)).all()]
            q = q.filter(Resignation.employee_id.in_(emp_ids)) if emp_ids else q.filter(False)
    rows = q.order_by(Resignation.id.desc()).all()
    return [_resignation_to_dict(r) for r in rows]


@router.post("/resignations")
def create_resignation(
    employee_id: int = Form(...),
    ref_no: str = Form(""),
    name_en: str = Form(""), name_ar: str = Form(""),
    civil_id: str = Form(""), nationality: str = Form(""),
    job_title: str = Form(""), department_branch: str = Form(""),
    date_of_joining: str = Form(""), last_working_day: str = Form(""),
    mobile: str = Form(""), email: str = Form(""),
    reason: str = Form(""), resignation_date: str = Form(""),
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    if user.role not in SALARY_VISIBLE_ROLES:
        raise HTTPException(403, "Not authorized")
    r = Resignation(
        employee_id=employee_id,
        ref_no=ref_no or None,
        name_en=name_en or None, name_ar=name_ar or None,
        civil_id=civil_id or None, nationality=nationality or None,
        job_title=job_title or None, department_branch=department_branch or None,
        date_of_joining=date.fromisoformat(date_of_joining) if date_of_joining else None,
        last_working_day=date.fromisoformat(last_working_day) if last_working_day else None,
        mobile=mobile or None, email=email or None,
        reason=reason or None,
        resignation_date=date.fromisoformat(resignation_date) if resignation_date else None,
    )
    db.add(r)
    # Sync dates to employee record
    emp = db.query(Employee).filter(Employee.id == employee_id).first()
    if emp:
        if resignation_date:
            emp.termination_date = date.fromisoformat(resignation_date)
        if last_working_day:
            emp.last_working_date = date.fromisoformat(last_working_day)
    db.commit()
    db.refresh(r)
    return _resignation_to_dict(r)


@router.put("/resignations/{res_id}")
def update_resignation(
    res_id: int,
    ref_no: str = Form(""),
    name_en: str = Form(""), name_ar: str = Form(""),
    civil_id: str = Form(""), nationality: str = Form(""),
    job_title: str = Form(""), department_branch: str = Form(""),
    date_of_joining: str = Form(""), last_working_day: str = Form(""),
    mobile: str = Form(""), email: str = Form(""),
    reason: str = Form(""), resignation_date: str = Form(""),
    company_id_returned: bool = Form(False), uniform_returned: bool = Form(False),
    locker_keys_handed: bool = Form(False), equipment_returned: bool = Form(False),
    loans_cleared: bool = Form(False), handover_completed: bool = Form(False),
    final_settlement_calculated: bool = Form(False), final_salary_paid: bool = Form(False),
    ops_manager_name: str = Form(""), ops_manager_status: str = Form("pending"),
    ops_manager_date: str = Form(""),
    gm_name: str = Form(""), gm_status: str = Form("pending"),
    gm_date: str = Form(""),
    finance_manager_name: str = Form(""),
    last_salary_paid_amount: float = Form(0),
    end_of_service: float = Form(0),
    leave_encashment: float = Form(0),
    deductions_amount: float = Form(0),
    final_settlement_amount: float = Form(0),
    finance_date: str = Form(""),
    dues_cleared_consent: bool = Form(False),
    consent_date: str = Form(""),
    status: str = Form("draft"),
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    if user.role not in SALARY_VISIBLE_ROLES:
        raise HTTPException(403, "Not authorized")
    r = db.query(Resignation).filter(Resignation.id == res_id).first()
    if not r:
        raise HTTPException(404, "Resignation not found")
    r.ref_no = ref_no or None
    r.name_en = name_en or None
    r.name_ar = name_ar or None
    r.civil_id = civil_id or None
    r.nationality = nationality or None
    r.job_title = job_title or None
    r.department_branch = department_branch or None
    r.date_of_joining = date.fromisoformat(date_of_joining) if date_of_joining else None
    r.last_working_day = date.fromisoformat(last_working_day) if last_working_day else None
    r.mobile = mobile or None
    r.email = email or None
    r.reason = reason or None
    r.resignation_date = date.fromisoformat(resignation_date) if resignation_date else None
    r.company_id_returned = company_id_returned
    r.uniform_returned = uniform_returned
    r.locker_keys_handed = locker_keys_handed
    r.equipment_returned = equipment_returned
    r.loans_cleared = loans_cleared
    r.handover_completed = handover_completed
    r.final_settlement_calculated = final_settlement_calculated
    r.final_salary_paid = final_salary_paid
    r.ops_manager_name = ops_manager_name or None
    r.ops_manager_status = ops_manager_status
    r.ops_manager_date = date.fromisoformat(ops_manager_date) if ops_manager_date else None
    r.gm_name = gm_name or None
    r.gm_status = gm_status
    r.gm_date = date.fromisoformat(gm_date) if gm_date else None
    r.finance_manager_name = finance_manager_name or None
    r.last_salary_paid_amount = last_salary_paid_amount
    r.end_of_service = end_of_service
    r.leave_encashment = leave_encashment
    r.deductions_amount = deductions_amount
    r.final_settlement_amount = final_settlement_amount
    r.finance_date = date.fromisoformat(finance_date) if finance_date else None
    r.dues_cleared_consent = dues_cleared_consent
    r.consent_date = date.fromisoformat(consent_date) if consent_date else None
    r.status = status
    # Sync dates to employee record
    emp = db.query(Employee).filter(Employee.id == r.employee_id).first()
    if emp:
        if resignation_date:
            emp.termination_date = date.fromisoformat(resignation_date)
        if last_working_day:
            emp.last_working_date = date.fromisoformat(last_working_day)
    db.commit()
    db.refresh(r)
    return _resignation_to_dict(r)


@router.delete("/resignations/{res_id}")
def delete_resignation(res_id: int, db: Session = Depends(get_db),
                       user: User = Depends(get_current_user)):
    if user.role not in SALARY_VISIBLE_ROLES:
        raise HTTPException(403, "Not authorized")
    r = db.query(Resignation).filter(Resignation.id == res_id).first()
    if not r:
        raise HTTPException(404, "Resignation not found")
    db.delete(r)
    db.commit()
    return {"ok": True}


# --- Contracts & Subscriptions ---
def _contract_to_dict(c):
    return {
        "id": c.id, "brand_id": c.brand_id, "name": c.name or "", "kind": c.kind or "",
        "place": c.place or "", "value": c.value or 0,
        "start_date": str(c.start_date) if c.start_date else "",
        "end_date": str(c.end_date) if c.end_date else "",
        "monthly_payment": c.monthly_payment or 0,
        "payment_day": c.payment_day or 1,
        "notes": c.notes or "", "status": c.status or "active",
        "created_at": str(c.created_at) if c.created_at else "",
    }


@router.get("/contracts")
def list_contracts(brand_id: Optional[int] = None, db: Session = Depends(get_db), _=Depends(get_current_user)):
    q = db.query(Contract)
    if brand_id:
        q = q.filter(Contract.brand_id == brand_id)
    rows = q.order_by(Contract.id.desc()).all()
    return [_contract_to_dict(c) for c in rows]


@router.post("/contracts")
def create_contract(
    name: str = Form(...),
    kind: str = Form(""), place: str = Form(""),
    value: float = Form(0), start_date: str = Form(""),
    end_date: str = Form(""), monthly_payment: float = Form(0),
    payment_day: int = Form(1), notes: str = Form(""),
    status: str = Form("active"),
    brand_id: Optional[int] = Form(None),
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    if user.role not in SALARY_VISIBLE_ROLES:
        raise HTTPException(403, "Not authorized")
    c = Contract(
        name=name, kind=kind or None, place=place or None,
        value=value, monthly_payment=monthly_payment,
        payment_day=payment_day, notes=notes or None, status=status,
        brand_id=brand_id,
        start_date=date.fromisoformat(start_date) if start_date else None,
        end_date=date.fromisoformat(end_date) if end_date else None,
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    return _contract_to_dict(c)


@router.put("/contracts/{contract_id}")
def update_contract(
    contract_id: int,
    name: str = Form(...),
    kind: str = Form(""), place: str = Form(""),
    value: float = Form(0), start_date: str = Form(""),
    end_date: str = Form(""), monthly_payment: float = Form(0),
    payment_day: int = Form(1), notes: str = Form(""),
    status: str = Form("active"),
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    if user.role not in SALARY_VISIBLE_ROLES:
        raise HTTPException(403, "Not authorized")
    c = db.query(Contract).filter(Contract.id == contract_id).first()
    if not c:
        raise HTTPException(404, "Contract not found")
    c.name = name
    c.kind = kind or None
    c.place = place or None
    c.value = value
    c.monthly_payment = monthly_payment
    c.payment_day = payment_day
    c.notes = notes or None
    c.status = status
    c.start_date = date.fromisoformat(start_date) if start_date else None
    c.end_date = date.fromisoformat(end_date) if end_date else None
    db.commit()
    db.refresh(c)
    return _contract_to_dict(c)


@router.delete("/contracts/{contract_id}")
def delete_contract(contract_id: int, db: Session = Depends(get_db),
                    user: User = Depends(get_current_user)):
    if user.role not in SALARY_VISIBLE_ROLES:
        raise HTTPException(403, "Not authorized")
    c = db.query(Contract).filter(Contract.id == contract_id).first()
    if not c:
        raise HTTPException(404, "Contract not found")
    db.delete(c)
    db.commit()
    return {"ok": True}

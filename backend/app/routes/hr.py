from fastapi import APIRouter, Depends, Form
from sqlalchemy.orm import Session
from datetime import date, time
from typing import Optional

from app.database import get_db
from app.models.hr import Employee, Attendance
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

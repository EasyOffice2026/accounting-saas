from fastapi import APIRouter, Depends, UploadFile, File, Form
from sqlalchemy.orm import Session
from datetime import date
from typing import Optional
import os, uuid

from app.database import get_db
from app.models.expense import ExpenseCategory, Expense
from app.models.user import User
from app.utils.auth import get_current_user

router = APIRouter(prefix="/api/expenses", tags=["expenses"])
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "uploads")


@router.get("/categories")
def list_categories(db: Session = Depends(get_db)):
    return db.query(ExpenseCategory).filter(ExpenseCategory.is_active == True).all()


@router.post("/categories")
def create_category(name: str = Form(...), name_ar: str = Form(""),
                    db: Session = Depends(get_db), _=Depends(get_current_user)):
    cat = ExpenseCategory(name=name, name_ar=name_ar)
    db.add(cat)
    db.commit()
    db.refresh(cat)
    return cat


@router.get("/")
def list_expenses(branch_id: Optional[int] = None, db: Session = Depends(get_db),
                  user: User = Depends(get_current_user)):
    q = db.query(Expense)
    if branch_id:
        q = q.filter(Expense.branch_id == branch_id)
    elif user.role == "staff" and user.branch_id:
        q = q.filter(Expense.branch_id == user.branch_id)
    return q.order_by(Expense.date.desc()).all()


@router.post("/")
def create_expense(
    branch_id: int = Form(...), expense_date: str = Form(...),
    description: str = Form(...), amount: float = Form(...),
    category_id: Optional[int] = Form(None),
    payment_method: str = Form("cash"), notes: str = Form(""),
    attachment: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    attachment_path = None
    if attachment and attachment.filename:
        ext = os.path.splitext(attachment.filename)[1]
        fname = f"{uuid.uuid4().hex}{ext}"
        os.makedirs(UPLOAD_DIR, exist_ok=True)
        with open(os.path.join(UPLOAD_DIR, fname), "wb") as f:
            f.write(attachment.file.read())
        attachment_path = fname

    exp = Expense(
        branch_id=branch_id, category_id=category_id,
        date=date.fromisoformat(expense_date),
        description=description, amount=amount,
        payment_method=payment_method, notes=notes,
        attachment_path=attachment_path, created_by=user.id,
    )
    db.add(exp)
    db.commit()
    db.refresh(exp)
    return exp

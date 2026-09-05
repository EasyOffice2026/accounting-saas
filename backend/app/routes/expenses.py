from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from sqlalchemy.orm import Session
from datetime import date
from typing import Optional
import os, uuid

from app.database import get_db, UPLOAD_DIR
from app.models.expense import ExpenseCategory, Expense
from app.models.purchase import Supplier
from app.models.branch import Branch
from app.models.user import User
from app.utils.auth import get_current_user
from app.routes.hr import _brand_branch_ids
from app.utils.dates import apply_date_range

router = APIRouter(prefix="/api/expenses", tags=["expenses"])


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


@router.delete("/categories/{category_id}")
def delete_category(category_id: int, db: Session = Depends(get_db),
                    user: User = Depends(get_current_user)):
    if user.role not in ("owner", "manager", "accountant"):
        raise HTTPException(403, "Only owner/manager can manage categories")
    cat = db.query(ExpenseCategory).filter(ExpenseCategory.id == category_id).first()
    if not cat:
        raise HTTPException(404, "Category not found")
    cat.is_active = False
    db.commit()
    return {"status": "deleted"}


@router.get("/")
def list_expenses(branch_id: Optional[int] = None, brand_id: Optional[int] = None,
                  date_from: Optional[str] = None, date_to: Optional[str] = None,
                  db: Session = Depends(get_db),
                  user: User = Depends(get_current_user)):
    q = db.query(Expense)
    bb_ids = _brand_branch_ids(db, brand_id)
    if user.role == "staff" and user.branch_id:
        # Branch staff only ever see their own branch's expenses
        q = q.filter(Expense.branch_id == user.branch_id)
    elif branch_id:
        q = q.filter(Expense.branch_id == branch_id)
    elif bb_ids is not None:
        q = q.filter(Expense.branch_id.in_(bb_ids))
    q = apply_date_range(q, Expense.date, date_from, date_to)
    return q.order_by(Expense.date.desc()).all()


@router.post("/")
def create_expense(
    branch_id: int = Form(...), expense_date: str = Form(...),
    description: str = Form(...), amount: float = Form(...),
    category_id: Optional[int] = Form(None), supplier_id: Optional[int] = Form(None),
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
        supplier_id=supplier_id if supplier_id else None,
        date=date.fromisoformat(expense_date),
        description=description, amount=amount,
        payment_method=payment_method, notes=notes,
        attachment_path=attachment_path, created_by=user.id,
    )
    db.add(exp)
    db.commit()
    db.refresh(exp)

    # Auto-send to supplier's WhatsApp group
    try:
        from app.routes.whatsapp import _send_to_entity_group
        supplier = db.query(Supplier).filter(Supplier.id == supplier_id).first() if supplier_id else None
        if supplier and supplier.whatsapp_group:
            branch = db.query(Branch).filter(Branch.id == branch_id).first()
            category = db.query(ExpenseCategory).filter(ExpenseCategory.id == category_id).first() if category_id else None
            br_name = branch.name if branch else ""
            cat_name = category.name if category else ""
            msg = (f"\U0001f4b0 *Expense*\n"
                   f"\U0001f4c5 Date: {expense_date}\n"
                   f"\U0001f3ea Branch: {br_name}\n"
                   f"\U0001f3e2 Supplier: {supplier.name}\n")
            if cat_name:
                msg += f"\U0001f4c1 Category: {cat_name}\n"
            msg += (f"\U0001f4dd Description: {description}\n"
                    f"\U0001f4b3 Payment: {payment_method}\n"
                    f"*Amount: KD {amount:.3f}*")
            _send_to_entity_group(db, supplier.whatsapp_group, msg)
    except Exception:
        pass

    return exp


@router.put("/{expense_id}")
def update_expense(
    expense_id: int,
    branch_id: int = Form(...), expense_date: str = Form(...),
    description: str = Form(...), amount: float = Form(...),
    category_id: Optional[int] = Form(None), supplier_id: Optional[int] = Form(None),
    payment_method: str = Form("cash"), notes: str = Form(""),
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    exp = db.query(Expense).filter(Expense.id == expense_id).first()
    if not exp:
        from fastapi import HTTPException
        raise HTTPException(404, "Expense not found")
    if exp.contract_payment_id:
        from fastapi import HTTPException
        raise HTTPException(400, "This expense is managed from Contracts & Subscriptions")
    exp.branch_id = branch_id
    exp.category_id = category_id
    exp.supplier_id = supplier_id if supplier_id else None
    exp.date = date.fromisoformat(expense_date)
    exp.description = description
    exp.amount = amount
    exp.payment_method = payment_method
    exp.notes = notes or None
    db.commit()
    db.refresh(exp)
    return exp


@router.delete("/{expense_id}")
def delete_expense(expense_id: int, db: Session = Depends(get_db),
                   user: User = Depends(get_current_user)):
    if user.role not in ("owner", "manager", "accountant"):
        from fastapi import HTTPException
        raise HTTPException(403, "Only owner/manager can delete expenses")
    exp = db.query(Expense).filter(Expense.id == expense_id).first()
    if not exp:
        from fastapi import HTTPException
        raise HTTPException(404, "Expense not found")
    if exp.contract_payment_id:
        from fastapi import HTTPException
        raise HTTPException(400, "This expense is managed from Contracts & Subscriptions")
    db.delete(exp)
    db.commit()
    return {"ok": True}


@router.get("/supplier-ledger")
def expense_supplier_ledger(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    suppliers = db.query(Supplier).order_by(Supplier.name).all()
    branches = {b.id: b.name for b in db.query(Branch).all()}
    result = []
    for s in suppliers:
        q = db.query(Expense).filter(Expense.supplier_id == s.id)
        if user.role == "staff" and user.branch_id:
            q = q.filter(Expense.branch_id == user.branch_id)
        expenses = q.order_by(Expense.date.desc()).all()
        if not expenses:
            continue
        total_cash = sum(e.amount for e in expenses if e.payment_method == "cash")
        total_credit = sum(e.amount for e in expenses if e.payment_method == "credit")
        total_amount = sum(e.amount for e in expenses)
        result.append({
            "supplier_id": s.id,
            "supplier_name": s.name,
            "total_amount": total_amount,
            "total_cash": total_cash,
            "total_credit": total_credit,
            "expenses": [{
                "id": e.id,
                "date": str(e.date),
                "description": e.description,
                "amount": e.amount,
                "payment_method": e.payment_method,
                "branch_name": branches.get(e.branch_id, ""),
            } for e in expenses],
        })
    return result

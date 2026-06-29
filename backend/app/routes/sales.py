from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import date
from typing import Optional
import os, uuid

from app.database import get_db
from app.models.sale import Sale, SaleReturn
from app.models.user import User
from app.utils.auth import get_current_user
from app.routes.hr import _brand_branch_ids

router = APIRouter(prefix="/api/sales", tags=["sales"])
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "uploads")


@router.get("/")
def list_sales(branch_id: Optional[int] = None, brand_id: Optional[int] = None,
               db: Session = Depends(get_db),
               user: User = Depends(get_current_user)):
    q = db.query(Sale)
    bb_ids = _brand_branch_ids(db, brand_id)
    if branch_id:
        q = q.filter(Sale.branch_id == branch_id)
    elif bb_ids is not None:
        q = q.filter(Sale.branch_id.in_(bb_ids))
    elif user.role == "staff" and user.branch_id:
        q = q.filter(Sale.branch_id == user.branch_id)
    return q.order_by(Sale.date.desc()).all()


@router.post("/")
def create_sale(
    branch_id: int = Form(...),
    sale_date: str = Form(...),
    foodics_cash: float = Form(0), foodics_knet: float = Form(0),
    foodics_link: float = Form(0), foodics_wamd: float = Form(0),
    foodics_talabat: float = Form(0), foodics_keeta: float = Form(0),
    foodics_jahez: float = Form(0), foodics_other: float = Form(0),
    foodics_snoonu: float = Form(0),
    physical_cash: float = Form(0), physical_knet: float = Form(0),
    physical_link: float = Form(0), physical_wamd: float = Form(0),
    physical_talabat: float = Form(0), physical_keeta: float = Form(0),
    physical_jahez: float = Form(0), physical_other: float = Form(0),
    physical_snoonu: float = Form(0),
    notes: str = Form(""),
    attachment: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    # Prevent duplicate date per branch
    existing = db.query(Sale).filter(
        Sale.branch_id == branch_id,
        Sale.date == date.fromisoformat(sale_date),
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Sales data already exists for this date and branch")

    attachment_path = None
    if attachment and attachment.filename:
        ext = os.path.splitext(attachment.filename)[1]
        fname = f"{uuid.uuid4().hex}{ext}"
        path = os.path.join(UPLOAD_DIR, fname)
        os.makedirs(UPLOAD_DIR, exist_ok=True)
        with open(path, "wb") as f:
            f.write(attachment.file.read())
        attachment_path = fname

    sale = Sale(
        branch_id=branch_id, date=date.fromisoformat(sale_date),
        foodics_cash=foodics_cash, foodics_knet=foodics_knet,
        foodics_link=foodics_link, foodics_wamd=foodics_wamd,
        foodics_talabat=foodics_talabat, foodics_keeta=foodics_keeta,
        foodics_jahez=foodics_jahez, foodics_other=foodics_other,
        foodics_snoonu=foodics_snoonu,
        physical_cash=physical_cash, physical_knet=physical_knet,
        physical_link=physical_link, physical_wamd=physical_wamd,
        physical_talabat=physical_talabat, physical_keeta=physical_keeta,
        physical_jahez=physical_jahez, physical_other=physical_other,
        physical_snoonu=physical_snoonu,
        notes=notes, attachment_path=attachment_path,
        created_by=user.id,
    )
    db.add(sale)
    db.commit()
    db.refresh(sale)
    return sale


@router.get("/summary")
def sales_summary(branch_id: Optional[int] = None, db: Session = Depends(get_db),
                  _=Depends(get_current_user)):
    q = db.query(Sale)
    if branch_id:
        q = q.filter(Sale.branch_id == branch_id)
    rows = q.all()
    total_foodics = sum(
        (r.foodics_cash or 0) + (r.foodics_knet or 0) + (r.foodics_link or 0) +
        (r.foodics_wamd or 0) + (r.foodics_talabat or 0) + (r.foodics_keeta or 0) +
        (r.foodics_jahez or 0) + (r.foodics_other or 0) + (r.foodics_snoonu or 0) for r in rows
    )
    total_physical = sum(
        (r.physical_cash or 0) + (r.physical_knet or 0) + (r.physical_link or 0) +
        (r.physical_wamd or 0) + (r.physical_talabat or 0) + (r.physical_keeta or 0) +
        (r.physical_jahez or 0) + (r.physical_other or 0) + (r.physical_snoonu or 0) for r in rows
    )
    return {
        "total_foodics": total_foodics,
        "total_physical": total_physical,
        "difference": total_physical - total_foodics,
        "count": len(rows),
    }


@router.get("/returns")
def list_returns(branch_id: Optional[int] = None, db: Session = Depends(get_db),
                 _=Depends(get_current_user)):
    q = db.query(SaleReturn)
    if branch_id:
        q = q.filter(SaleReturn.branch_id == branch_id)
    return q.order_by(SaleReturn.date.desc()).all()


@router.post("/returns")
def create_return(branch_id: int = Form(...), return_date: str = Form(...),
                  return_type: str = Form("return"), quantity: int = Form(0),
                  amount: float = Form(0), reason: str = Form(""),
                  db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    sr = SaleReturn(branch_id=branch_id, date=date.fromisoformat(return_date),
                    return_type=return_type, quantity=quantity, amount=amount,
                    reason=reason, created_by=user.id)
    db.add(sr)
    db.commit()
    db.refresh(sr)
    return sr

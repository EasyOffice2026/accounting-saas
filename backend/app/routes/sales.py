from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import date, timedelta
from typing import Optional
import os, uuid

from app.database import get_db, UPLOAD_DIR
from app.models.sale import Sale, SaleReturn
from app.models.branch import Branch
from app.models.user import User
from app.utils.auth import get_current_user
from app.routes.hr import _brand_branch_ids

router = APIRouter(prefix="/api/sales", tags=["sales"])


@router.get("/")
def list_sales(branch_id: Optional[int] = None, brand_id: Optional[int] = None,
               db: Session = Depends(get_db),
               user: User = Depends(get_current_user)):
    q = db.query(Sale)
    bb_ids = _brand_branch_ids(db, brand_id)
    if user.role == "staff" and user.branch_id:
        # Branch staff only ever see their own branch's sales
        q = q.filter(Sale.branch_id == user.branch_id)
    elif branch_id:
        q = q.filter(Sale.branch_id == branch_id)
    elif bb_ids is not None:
        q = q.filter(Sale.branch_id.in_(bb_ids))
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
    cancelled_cash: float = Form(0), cancelled_knet: float = Form(0),
    cancelled_link: float = Form(0), cancelled_talabat: float = Form(0),
    cancelled_keeta: float = Form(0), cancelled_jahez: float = Form(0),
    cancelled_snoonu: float = Form(0),
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
        cancelled_cash=cancelled_cash, cancelled_knet=cancelled_knet,
        cancelled_link=cancelled_link, cancelled_talabat=cancelled_talabat,
        cancelled_keeta=cancelled_keeta, cancelled_jahez=cancelled_jahez,
        cancelled_snoonu=cancelled_snoonu,
        notes=notes, attachment_path=attachment_path,
        created_by=user.id,
    )
    db.add(sale)
    db.commit()
    db.refresh(sale)

    # Auto-send detailed report to branch's WhatsApp group (Arabic message)
    try:
        from app.routes.whatsapp import _send_to_entity_group, build_sales_message
        branch = db.query(Branch).filter(Branch.id == branch_id).first()
        if branch and branch.whatsapp_group:
            msg = build_sales_message(sale, branch, sale.date, "ar")
            _send_to_entity_group(db, branch.whatsapp_group, msg)
    except Exception:
        pass

    return sale


def _can_modify_sale(user: User, sale: Sale):
    if user.role in ("owner", "manager", "accountant"):
        return True
    if user.role == "staff" and user.branch_id and sale.branch_id == user.branch_id:
        return True
    return False


@router.put("/{sale_id}")
def update_sale(
    sale_id: int,
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
    cancelled_cash: float = Form(0), cancelled_knet: float = Form(0),
    cancelled_link: float = Form(0), cancelled_talabat: float = Form(0),
    cancelled_keeta: float = Form(0), cancelled_jahez: float = Form(0),
    cancelled_snoonu: float = Form(0),
    notes: str = Form(""),
    attachment: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    sale = db.query(Sale).filter(Sale.id == sale_id).first()
    if not sale:
        raise HTTPException(status_code=404, detail="Sale not found")
    if not _can_modify_sale(user, sale):
        raise HTTPException(status_code=403, detail="Not allowed")

    new_date = date.fromisoformat(sale_date)
    duplicate = db.query(Sale).filter(
        Sale.branch_id == branch_id,
        Sale.date == new_date,
        Sale.id != sale_id,
    ).first()
    if duplicate:
        raise HTTPException(status_code=400, detail="Sales data already exists for this date and branch")

    if attachment and attachment.filename:
        ext = os.path.splitext(attachment.filename)[1]
        fname = f"{uuid.uuid4().hex}{ext}"
        path = os.path.join(UPLOAD_DIR, fname)
        os.makedirs(UPLOAD_DIR, exist_ok=True)
        with open(path, "wb") as f:
            f.write(attachment.file.read())
        sale.attachment_path = fname

    sale.branch_id = branch_id
    sale.date = new_date
    sale.foodics_cash = foodics_cash; sale.foodics_knet = foodics_knet
    sale.foodics_link = foodics_link; sale.foodics_wamd = foodics_wamd
    sale.foodics_talabat = foodics_talabat; sale.foodics_keeta = foodics_keeta
    sale.foodics_jahez = foodics_jahez; sale.foodics_other = foodics_other
    sale.foodics_snoonu = foodics_snoonu
    sale.physical_cash = physical_cash; sale.physical_knet = physical_knet
    sale.physical_link = physical_link; sale.physical_wamd = physical_wamd
    sale.physical_talabat = physical_talabat; sale.physical_keeta = physical_keeta
    sale.physical_jahez = physical_jahez; sale.physical_other = physical_other
    sale.physical_snoonu = physical_snoonu
    sale.cancelled_cash = cancelled_cash; sale.cancelled_knet = cancelled_knet
    sale.cancelled_link = cancelled_link; sale.cancelled_talabat = cancelled_talabat
    sale.cancelled_keeta = cancelled_keeta; sale.cancelled_jahez = cancelled_jahez
    sale.cancelled_snoonu = cancelled_snoonu
    sale.notes = notes
    db.commit()
    db.refresh(sale)
    return sale


@router.delete("/{sale_id}")
def delete_sale(sale_id: int, db: Session = Depends(get_db),
                user: User = Depends(get_current_user)):
    sale = db.query(Sale).filter(Sale.id == sale_id).first()
    if not sale:
        raise HTTPException(status_code=404, detail="Sale not found")
    if not _can_modify_sale(user, sale):
        raise HTTPException(status_code=403, detail="Not allowed")
    db.delete(sale)
    db.commit()
    return {"ok": True}


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


@router.get("/next-date")
def get_next_date(branch_id: int, db: Session = Depends(get_db),
                  _=Depends(get_current_user)):
    """Return the next expected date for sequential entry."""
    latest = db.query(Sale).filter(Sale.branch_id == branch_id).order_by(Sale.date.desc()).first()
    if latest:
        next_d = latest.date + timedelta(days=1)
    else:
        next_d = date.today()
    return {"next_date": next_d.isoformat(), "has_previous": latest is not None}


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

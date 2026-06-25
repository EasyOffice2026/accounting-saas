from fastapi import APIRouter, Depends, Query, Form, HTTPException
from sqlalchemy.orm import Session
from typing import Optional
from app.database import get_db
from app.models.branch import Branch
from app.utils.auth import get_current_user
from app.models.user import User

router = APIRouter(prefix="/api/branches", tags=["branches"])


@router.get("/")
def list_branches(brand_id: Optional[int] = None, db: Session = Depends(get_db)):
    q = db.query(Branch)
    if brand_id:
        q = q.filter(Branch.brand_id == brand_id)
    rows = q.all()
    return [{"id": b.id, "name": b.name, "name_ar": b.name_ar or "",
             "brand_id": b.brand_id, "is_central_kitchen": b.is_central_kitchen,
             "is_active": b.is_active} for b in rows]


@router.post("/")
def create_branch(name: str = Form(...), name_ar: str = Form(""),
                  is_central_kitchen: bool = Form(False),
                  brand_id: Optional[int] = Form(None),
                  db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role not in ("owner", "manager", "accountant"):
        raise HTTPException(403, "Not authorized")
    branch = Branch(name=name, name_ar=name_ar, is_central_kitchen=is_central_kitchen,
                    brand_id=brand_id)
    db.add(branch)
    db.commit()
    db.refresh(branch)
    return {"id": branch.id, "name": branch.name, "name_ar": branch.name_ar or "",
            "brand_id": branch.brand_id, "is_central_kitchen": branch.is_central_kitchen,
            "is_active": branch.is_active}


@router.put("/{branch_id}")
def update_branch(branch_id: int, name: str = Form(...), name_ar: str = Form(""),
                  is_central_kitchen: bool = Form(False),
                  brand_id: Optional[int] = Form(None),
                  db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role not in ("owner", "manager", "accountant"):
        raise HTTPException(403, "Not authorized")
    b = db.query(Branch).filter(Branch.id == branch_id).first()
    if not b:
        raise HTTPException(404, "Branch not found")
    b.name = name
    b.name_ar = name_ar
    b.is_central_kitchen = is_central_kitchen
    b.brand_id = brand_id
    db.commit()
    return {"id": b.id, "name": b.name, "name_ar": b.name_ar or "",
            "brand_id": b.brand_id, "is_central_kitchen": b.is_central_kitchen,
            "is_active": b.is_active}


@router.delete("/{branch_id}")
def delete_branch(branch_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role not in ("owner", "manager", "accountant"):
        raise HTTPException(403, "Not authorized")
    b = db.query(Branch).filter(Branch.id == branch_id).first()
    if not b:
        raise HTTPException(404, "Branch not found")
    db.delete(b)
    db.commit()
    return {"message": "Branch deleted"}

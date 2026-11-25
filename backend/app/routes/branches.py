from sqlalchemy import or_
from fastapi import APIRouter, Depends, Query, Form, HTTPException
from sqlalchemy.orm import Session
from typing import Optional
from app.database import get_db
from app.models.branch import Branch
from app.utils.auth import get_current_user
from app.models.user import User
from app.utils import units

router = APIRouter(prefix="/api/branches", tags=["branches"])


def _unit_type(unit_type: str, is_central_kitchen: bool) -> str:
    if not unit_type:
        return units.CENTRAL_KITCHEN if is_central_kitchen else units.SALES
    if unit_type not in units.UNIT_TYPES:
        raise HTTPException(400, "Unknown unit type")
    return unit_type


@router.get("/")
def list_branches(brand_id: Optional[int] = None, scope: Optional[str] = None,
                  db: Session = Depends(get_db)):
    q = db.query(Branch)
    if brand_id:
        q = q.filter(Branch.brand_id == brand_id)
    scopes = {
        "personnel": [units.PERSONNEL_OFFICE],
        "hr_officer": [units.PERSONNEL_OFFICE, units.HR_OFFICE],
        "hr": [units.HR_OFFICE],
        "purchase": [units.PURCHASE_OFFICE],
        "sales": [units.SALES],
        "stock": list(units.STOCK_UNITS),
        "central_store": [units.CENTRAL_STORE],
    }
    if scope in scopes:
        q = q.filter(Branch.unit_type.in_(scopes[scope]))
    elif scope == "operating":
        q = q.filter(~Branch.unit_type.in_(units.OFFICES))
    rows = q.all()
    return [{"id": b.id, "name": b.name, "name_ar": b.name_ar or "",
             "brand_id": b.brand_id, "is_central_kitchen": b.is_central_kitchen, "unit_type": b.unit_type,
             "whatsapp_number": b.whatsapp_number or "",
             "whatsapp_group": b.whatsapp_group or "",
             "is_active": b.is_active} for b in rows]


@router.post("/")
def create_branch(name: str = Form(...), name_ar: str = Form(""),
                  is_central_kitchen: bool = Form(False),
                  unit_type: str = Form(""),
                  brand_id: Optional[int] = Form(None),
                  whatsapp_number: str = Form(""),
                  whatsapp_group: str = Form(""),
                  db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role not in ("owner", "manager", "accountant"):
        raise HTTPException(403, "Not authorized")
    unit_type = _unit_type(unit_type, is_central_kitchen)
    branch = Branch(name=name, name_ar=name_ar, is_central_kitchen=unit_type == units.CENTRAL_KITCHEN,
                    unit_type=unit_type,
                    brand_id=brand_id, whatsapp_number=whatsapp_number or None,
                    whatsapp_group=whatsapp_group or None)
    db.add(branch)
    db.commit()
    db.refresh(branch)
    return {"id": branch.id, "name": branch.name, "name_ar": branch.name_ar or "",
            "brand_id": branch.brand_id, "is_central_kitchen": branch.is_central_kitchen, "unit_type": branch.unit_type,
            "whatsapp_number": branch.whatsapp_number or "",
            "whatsapp_group": branch.whatsapp_group or "",
            "is_active": branch.is_active}


@router.put("/{branch_id}")
def update_branch(branch_id: int, name: str = Form(...), name_ar: str = Form(""),
                  is_central_kitchen: bool = Form(False),
                  unit_type: str = Form(""),
                  brand_id: Optional[int] = Form(None),
                  whatsapp_number: str = Form(""),
                  whatsapp_group: str = Form(""),
                  db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    if user.role not in ("owner", "manager", "accountant"):
        raise HTTPException(403, "Not authorized")
    b = db.query(Branch).filter(Branch.id == branch_id).first()
    if not b:
        raise HTTPException(404, "Branch not found")
    b.name = name
    b.name_ar = name_ar
    b.unit_type = _unit_type(unit_type, is_central_kitchen) if unit_type or is_central_kitchen else b.unit_type
    b.is_central_kitchen = b.unit_type == units.CENTRAL_KITCHEN
    b.brand_id = brand_id
    b.whatsapp_number = whatsapp_number or None
    b.whatsapp_group = whatsapp_group or None
    db.commit()
    return {"id": b.id, "name": b.name, "name_ar": b.name_ar or "",
            "brand_id": b.brand_id, "is_central_kitchen": b.is_central_kitchen, "unit_type": b.unit_type,
            "whatsapp_number": b.whatsapp_number or "",
            "whatsapp_group": b.whatsapp_group or "",
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

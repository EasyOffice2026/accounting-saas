from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.branch import Branch
from app.utils.auth import get_current_user

router = APIRouter(prefix="/api/branches", tags=["branches"])


@router.get("/")
def list_branches(db: Session = Depends(get_db)):
    return db.query(Branch).all()


@router.post("/")
def create_branch(name: str, name_ar: str = "", is_central_kitchen: bool = False,
                  db: Session = Depends(get_db), _=Depends(get_current_user)):
    branch = Branch(name=name, name_ar=name_ar, is_central_kitchen=is_central_kitchen)
    db.add(branch)
    db.commit()
    db.refresh(branch)
    return branch

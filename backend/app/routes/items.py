from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.item import Item
from app.utils.auth import get_current_user
from app.models.user import User

router = APIRouter(prefix="/api/items", tags=["items"])


@router.get("/")
def list_items(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    rows = db.query(Item).filter(Item.is_active == True).order_by(Item.name).all()
    return [
        {"id": r.id, "name": r.name, "name_ar": r.name_ar, "unit": r.unit, "unit_price": r.unit_price}
        for r in rows
    ]


@router.post("/")
def create_item(
    name: str = Query(...),
    name_ar: str = Query(None),
    unit: str = Query("pcs"),
    unit_price: float = Query(0),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    item = Item(name=name, name_ar=name_ar, unit=unit, unit_price=unit_price)
    db.add(item)
    db.commit()
    db.refresh(item)
    return {"id": item.id, "status": "created"}


@router.put("/{item_id}")
def update_item(
    item_id: int,
    name: str = Query(None),
    name_ar: str = Query(None),
    unit: str = Query(None),
    unit_price: float = Query(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    item = db.query(Item).filter(Item.id == item_id).first()
    if not item:
        return {"error": "Not found"}
    if name is not None:
        item.name = name
    if name_ar is not None:
        item.name_ar = name_ar
    if unit is not None:
        item.unit = unit
    if unit_price is not None:
        item.unit_price = unit_price
    db.commit()
    return {"status": "updated"}

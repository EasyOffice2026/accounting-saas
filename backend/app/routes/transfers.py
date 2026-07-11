from fastapi import APIRouter, Depends, HTTPException, Form, Query
from sqlalchemy.orm import Session
from datetime import date, datetime, timezone
from typing import Optional
import json

from app.database import get_db
from app.models.transfer import TransferItem, TransferOrder, TransferOrderLine
from app.models.branch import Branch
from app.models.user import User
from app.utils.auth import get_current_user
from app.routes.hr import _brand_branch_ids

router = APIRouter(prefix="/api/transfers", tags=["transfers"])


# --- Transfer Items (Central Kitchen catalog) ---
@router.get("/items")
def list_transfer_items(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return db.query(TransferItem).filter(TransferItem.is_active == True).order_by(TransferItem.name).all()


@router.post("/items")
def create_transfer_item(
    name: str = Form(...), name_ar: str = Form(""), unit: str = Form("pcs"),
    unit_price: float = Form(0), opening_stock: float = Form(0),
    category: str = Form("food"),
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    if user.role not in ("owner", "manager", "accountant"):
        raise HTTPException(403, "Only owner/manager can manage transfer items")
    item = TransferItem(name=name, name_ar=name_ar or None, unit=unit, unit_price=unit_price, opening_stock=opening_stock, category=category)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.put("/items/{item_id}")
def update_transfer_item(
    item_id: int,
    name: str = Form(...), name_ar: str = Form(""), unit: str = Form("pcs"),
    unit_price: float = Form(0), opening_stock: float = Form(0),
    category: str = Form("food"),
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    if user.role not in ("owner", "manager", "accountant"):
        raise HTTPException(403, "Only owner/manager can manage transfer items")
    item = db.query(TransferItem).filter(TransferItem.id == item_id).first()
    if not item:
        raise HTTPException(404, "Item not found")
    item.name = name
    item.name_ar = name_ar or None
    item.unit = unit
    item.unit_price = unit_price
    item.opening_stock = opening_stock
    item.category = category
    db.commit()
    db.refresh(item)
    return item


@router.delete("/items/{item_id}")
def delete_transfer_item(item_id: int, db: Session = Depends(get_db),
                         user: User = Depends(get_current_user)):
    if user.role not in ("owner", "manager", "accountant"):
        raise HTTPException(403, "Only owner/manager can manage transfer items")
    item = db.query(TransferItem).filter(TransferItem.id == item_id).first()
    if not item:
        raise HTTPException(404, "Item not found")
    item.is_active = False
    db.commit()
    return {"status": "deleted"}


# --- Transfer Orders ---
@router.get("/orders")
def list_transfer_orders(brand_id: Optional[int] = None, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    q = db.query(TransferOrder)
    bb_ids = _brand_branch_ids(db, brand_id)
    # Staff sees only their branch requests; Central Kitchen staff sees all
    if user.role == "staff" and user.branch_id:
        branch = db.query(Branch).filter(Branch.id == user.branch_id).first()
        if branch and not branch.is_central_kitchen:
            q = q.filter(TransferOrder.requesting_branch_id == user.branch_id)
    elif bb_ids is not None:
        q = q.filter(TransferOrder.requesting_branch_id.in_(bb_ids))
    orders = q.order_by(TransferOrder.date.desc()).all()
    branches = {b.id: b.name for b in db.query(Branch).all()}
    result = []
    for o in orders:
        lines = db.query(TransferOrderLine).filter(
            TransferOrderLine.transfer_order_id == o.id
        ).all()
        result.append({
            "id": o.id,
            "requesting_branch_id": o.requesting_branch_id,
            "branch_name": branches.get(o.requesting_branch_id, ""),
            "date": str(o.date),
            "status": o.status,
            "notes": o.notes,
            "created_at": str(o.created_at) if o.created_at else None,
            "lines": [{
                "id": l.id,
                "item_id": l.item_id,
                "item_name": l.item_name,
                "item_name_ar": l.item_name_ar,
                "requested_qty": l.requested_qty,
                "dispatched_qty": l.dispatched_qty,
                "received_qty": l.received_qty,
                "unit": l.unit,
                "unit_price": l.unit_price or 0,
            } for l in lines],
        })
    return result


@router.post("/orders")
def create_transfer_order(
    requesting_branch_id: int = Form(...),
    order_date: str = Form(...),
    items: str = Form("[]"),
    notes: str = Form(""),
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    items_list = json.loads(items)
    if not items_list:
        raise HTTPException(400, "At least one item is required")

    order = TransferOrder(
        requesting_branch_id=requesting_branch_id,
        date=date.fromisoformat(order_date),
        notes=notes or None,
        created_by=user.id,
    )
    db.add(order)
    db.commit()
    db.refresh(order)

    for item in items_list:
        line = TransferOrderLine(
            transfer_order_id=order.id,
            item_id=int(item["item_id"]),
            item_name=item["item_name"],
            item_name_ar=item.get("item_name_ar") or None,
            requested_qty=float(item["requested_qty"]),
            unit=item.get("unit", "pcs"),
            unit_price=float(item.get("unit_price", 0)),
        )
        db.add(line)
    db.commit()
    return {"id": order.id, "status": "created"}


# --- Dispatch (Central Kitchen marks items sent) ---
@router.post("/orders/{order_id}/dispatch")
def dispatch_order(
    order_id: int,
    lines: str = Form("[]"),
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    order = db.query(TransferOrder).filter(TransferOrder.id == order_id).first()
    if not order:
        raise HTTPException(404, "Order not found")
    if order.status != "requested":
        raise HTTPException(400, "Order already dispatched or received")

    lines_data = json.loads(lines)
    for ld in lines_data:
        line = db.query(TransferOrderLine).filter(TransferOrderLine.id == int(ld["line_id"])).first()
        if line:
            line.dispatched_qty = float(ld.get("dispatched_qty", line.requested_qty))

    order.status = "dispatched"
    order.dispatched_at = datetime.now(timezone.utc)
    db.commit()
    return {"status": "dispatched"}


# --- Receive (Branch confirms items received) ---
@router.post("/orders/{order_id}/receive")
def receive_order(
    order_id: int,
    lines: str = Form("[]"),
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    order = db.query(TransferOrder).filter(TransferOrder.id == order_id).first()
    if not order:
        raise HTTPException(404, "Order not found")
    if order.status != "dispatched":
        raise HTTPException(400, "Order must be dispatched before receiving")

    lines_data = json.loads(lines)
    for ld in lines_data:
        line = db.query(TransferOrderLine).filter(TransferOrderLine.id == int(ld["line_id"])).first()
        if line:
            line.received_qty = float(ld.get("received_qty", line.dispatched_qty or line.requested_qty))

    order.status = "received"
    order.received_at = datetime.now(timezone.utc)
    db.commit()
    return {"status": "received"}


# --- Branch Summary (quantity & amount given to each branch) ---
@router.get("/branch-summary")
def branch_transfer_summary(brand_id: Optional[int] = None,
                            start_date: Optional[str] = None, end_date: Optional[str] = None,
                            db: Session = Depends(get_db),
                            user: User = Depends(get_current_user)):
    """Get total quantity and amount of items dispatched to each branch."""
    from sqlalchemy import func
    bb_ids = _brand_branch_ids(db, brand_id)
    q = db.query(
        TransferOrder.requesting_branch_id,
        TransferOrderLine.item_name,
        TransferOrderLine.item_name_ar,
        TransferOrderLine.unit,
        func.sum(TransferOrderLine.dispatched_qty).label("total_qty"),
        func.sum(TransferOrderLine.dispatched_qty * TransferOrderLine.unit_price).label("total_amount"),
    ).join(
        TransferOrderLine, TransferOrderLine.transfer_order_id == TransferOrder.id
    ).filter(
        TransferOrder.status.in_(["dispatched", "received"]),
        TransferOrderLine.dispatched_qty != None,
    )
    if start_date:
        q = q.filter(TransferOrder.date >= date.fromisoformat(start_date))
    if end_date:
        q = q.filter(TransferOrder.date <= date.fromisoformat(end_date))
    if bb_ids is not None:
        q = q.filter(TransferOrder.requesting_branch_id.in_(bb_ids))
    q = q.group_by(
        TransferOrder.requesting_branch_id,
        TransferOrderLine.item_name,
        TransferOrderLine.item_name_ar,
        TransferOrderLine.unit,
    )
    rows = q.all()
    branches = {b.id: {"name": b.name, "name_ar": b.name_ar} for b in db.query(Branch).all()}
    result = {}
    for r in rows:
        bid = r.requesting_branch_id
        if bid not in result:
            result[bid] = {"branch_id": bid, "branch_name": branches.get(bid, {}).get("name", ""),
                           "branch_name_ar": branches.get(bid, {}).get("name_ar", ""), "items": [], "total_amount": 0}
        result[bid]["items"].append({
            "item_name": r.item_name, "item_name_ar": r.item_name_ar,
            "unit": r.unit, "total_qty": r.total_qty or 0,
            "total_amount": round(r.total_amount or 0, 3),
        })
        result[bid]["total_amount"] = round(result[bid]["total_amount"] + (r.total_amount or 0), 3)
    return list(result.values())


# --- Inventory Stock (opening balance, transferred, remaining) ---
@router.get("/inventory")
def inventory_stock(start_date: Optional[str] = None, end_date: Optional[str] = None,
                    db: Session = Depends(get_db), _=Depends(get_current_user)):
    """Get stock status for all active items: opening_stock, total_dispatched, remaining."""
    from sqlalchemy import func
    all_items = db.query(TransferItem).filter(TransferItem.is_active == True).order_by(TransferItem.name).all()
    # Sum dispatched qty per item_id across all orders
    dq = db.query(
        TransferOrderLine.item_id,
        func.coalesce(func.sum(TransferOrderLine.dispatched_qty), 0).label("total"),
    ).join(TransferOrder, TransferOrder.id == TransferOrderLine.transfer_order_id)\
     .filter(TransferOrder.status.in_(["dispatched", "received"]))
    if start_date:
        dq = dq.filter(TransferOrder.date >= date.fromisoformat(start_date))
    if end_date:
        dq = dq.filter(TransferOrder.date <= date.fromisoformat(end_date))
    dispatched = dict(dq.group_by(TransferOrderLine.item_id).all())
    result = []
    for item in all_items:
        total_out = dispatched.get(item.id, 0)
        result.append({
            "id": item.id, "name": item.name, "name_ar": item.name_ar,
            "unit": item.unit, "unit_price": item.unit_price or 0,
            "opening_stock": item.opening_stock or 0,
            "total_dispatched": total_out,
            "remaining": round((item.opening_stock or 0) - total_out, 3),
            "category": item.category,
        })
    return result

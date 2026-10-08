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
from app.routes.export import _respond

router = APIRouter(prefix="/api/transfers", tags=["transfers"])


# --- Transfer Items (Central Kitchen catalog) ---
@router.get("/items")
def list_transfer_items(db: Session = Depends(get_db), _=Depends(get_current_user)):
    return db.query(TransferItem).filter(TransferItem.is_active == True).order_by(TransferItem.name).all()


def _require_item_manager(user: User):
    if user.role not in ("owner", "manager", "accountant"):
        raise HTTPException(403, "Only owner/manager/accountant can manage transfer items")


@router.post("/items")
def create_transfer_item(
    name: str = Form(...), name_ar: str = Form(""), unit: str = Form("pcs"),
    unit_price: float = Form(0), opening_stock: float = Form(0),
    category: str = Form("food"),
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    _require_item_manager(user)
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
    _require_item_manager(user)
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
def list_transfer_orders(brand_id: Optional[int] = None, branch_id: Optional[int] = None,
                         db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    q = db.query(TransferOrder)
    bb_ids = _brand_branch_ids(db, brand_id)
    if branch_id:
        q = q.filter(
            (TransferOrder.requesting_branch_id == branch_id)
            | (TransferOrder.source_branch_id == branch_id)
        )
    # Staff sees only orders involving their branch (as source or destination);
    # Central Kitchen staff sees all
    if user.role == "staff" and user.branch_id:
        branch = db.query(Branch).filter(Branch.id == user.branch_id).first()
        if branch and not branch.is_central_kitchen:
            q = q.filter(
                (TransferOrder.requesting_branch_id == user.branch_id)
                | (TransferOrder.source_branch_id == user.branch_id)
            )
    elif bb_ids is not None:
        q = q.filter(
            (TransferOrder.requesting_branch_id.in_(bb_ids))
            | (TransferOrder.source_branch_id.in_(bb_ids))
        )
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
            "source_branch_id": o.source_branch_id,
            "source_branch_name": branches.get(o.source_branch_id, "") if o.source_branch_id else "",
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
    source_branch_id: Optional[int] = Form(None),
    order_date: str = Form(...),
    items: str = Form("[]"),
    notes: str = Form(""),
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    items_list = json.loads(items)
    if not items_list:
        raise HTTPException(400, "At least one item is required")
    if source_branch_id and source_branch_id == requesting_branch_id:
        raise HTTPException(400, "Source and destination branch cannot be the same")

    order = TransferOrder(
        requesting_branch_id=requesting_branch_id,
        source_branch_id=source_branch_id,
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


@router.put("/orders/{order_id}")
def update_transfer_order(
    order_id: int,
    requesting_branch_id: int = Form(...),
    source_branch_id: Optional[int] = Form(None),
    order_date: str = Form(...),
    items: str = Form("[]"),
    notes: str = Form(""),
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    order = db.query(TransferOrder).filter(TransferOrder.id == order_id).first()
    if not order:
        raise HTTPException(404, "Order not found")
    if order.status != "requested":
        raise HTTPException(400, "Only pending requests can be edited")
    items_list = json.loads(items)
    if not items_list:
        raise HTTPException(400, "At least one item is required")
    if source_branch_id and source_branch_id == requesting_branch_id:
        raise HTTPException(400, "Source and destination branch cannot be the same")

    order.requesting_branch_id = requesting_branch_id
    order.source_branch_id = source_branch_id
    order.date = date.fromisoformat(order_date)
    order.notes = notes or None

    db.query(TransferOrderLine).filter(TransferOrderLine.transfer_order_id == order.id).delete()
    for item in items_list:
        db.add(TransferOrderLine(
            transfer_order_id=order.id,
            item_id=int(item["item_id"]),
            item_name=item["item_name"],
            item_name_ar=item.get("item_name_ar") or None,
            requested_qty=float(item["requested_qty"]),
            unit=item.get("unit", "pcs"),
            unit_price=float(item.get("unit_price", 0)),
        ))
    db.commit()
    return {"id": order.id, "status": "updated"}


@router.delete("/orders/{order_id}")
def delete_transfer_order(
    order_id: int,
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    order = db.query(TransferOrder).filter(TransferOrder.id == order_id).first()
    if not order:
        raise HTTPException(404, "Order not found")
    if order.status != "requested":
        raise HTTPException(400, "Only pending requests can be deleted")
    db.query(TransferOrderLine).filter(TransferOrderLine.transfer_order_id == order.id).delete()
    db.delete(order)
    db.commit()
    return {"status": "deleted"}


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
def _consumption_rows(db: Session, user: User, brand_id: Optional[int],
                      start_date: Optional[str], end_date: Optional[str]):
    """Dispatched qty grouped by receiving branch and item. Lines in the item's current unit are
    valued at its current price; lines recorded in another unit keep their transfer price."""
    from sqlalchemy import case, func
    bb_ids = _brand_branch_ids(db, brand_id)
    q = db.query(
        TransferOrder.requesting_branch_id,
        TransferItem.name.label("item_name"),
        TransferItem.name_ar.label("item_name_ar"),
        TransferItem.unit.label("unit"),
        func.sum(TransferOrderLine.dispatched_qty).label("total_qty"),
        func.sum(TransferOrderLine.dispatched_qty * case(
            (func.lower(func.trim(TransferOrderLine.unit)) == func.lower(func.trim(TransferItem.unit)),
             func.coalesce(TransferItem.unit_price, 0)),
            else_=func.coalesce(TransferOrderLine.unit_price, 0),
        )).label("total_amount"),
    ).join(
        TransferOrderLine, TransferOrderLine.transfer_order_id == TransferOrder.id
    ).join(
        TransferItem, TransferItem.id == TransferOrderLine.item_id
    ).filter(
        TransferOrder.status.in_(["dispatched", "received"]),
        TransferOrderLine.dispatched_qty != None,
    )
    if start_date:
        q = q.filter(TransferOrder.date >= date.fromisoformat(start_date))
    if end_date:
        q = q.filter(TransferOrder.date <= date.fromisoformat(end_date))
    if user.role == "staff" and user.branch_id:
        branch = db.query(Branch).filter(Branch.id == user.branch_id).first()
        if branch and not branch.is_central_kitchen:
            q = q.filter(TransferOrder.requesting_branch_id == user.branch_id)
    elif bb_ids is not None:
        # Include both consumption by this brand's branches AND orders that other
        # brands sourced FROM this brand (e.g. Khubuz Maraei ordering from Mudawwarah's
        # Central Kitchen shows up in Mudawwarah's consumption view).
        q = q.filter(
            (TransferOrder.requesting_branch_id.in_(bb_ids))
            | (TransferOrder.source_branch_id.in_(bb_ids))
        )
    q = q.group_by(
        TransferOrder.requesting_branch_id,
        TransferItem.id,
        TransferItem.name,
        TransferItem.name_ar,
        TransferItem.unit,
    )
    return q.all()


@router.get("/branch-summary")
def branch_transfer_summary(brand_id: Optional[int] = None,
                            start_date: Optional[str] = None, end_date: Optional[str] = None,
                            db: Session = Depends(get_db),
                            user: User = Depends(get_current_user)):
    """Get total quantity and amount of items dispatched to each branch."""
    rows = _consumption_rows(db, user, brand_id, start_date, end_date)
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


def _product_consumption(db: Session, user: User, brand_id: Optional[int], start_date: Optional[str],
                         end_date: Optional[str], branch_id: Optional[int],
                         branch_ids: Optional[str] = None) -> dict:
    rows = _consumption_rows(db, user, brand_id, start_date, end_date)
    if branch_id:
        rows = [r for r in rows if r.requesting_branch_id == branch_id]
    if branch_ids:
        wanted = {int(x) for x in branch_ids.split(",") if x.strip().isdigit()}
        rows = [r for r in rows if r.requesting_branch_id in wanted]
    branch_by_id = {b.id: b for b in db.query(Branch).all()}
    products: dict[tuple, dict] = {}
    for r in rows:
        bid = r.requesting_branch_id
        qty, amount = float(r.total_qty or 0), float(r.total_amount or 0)
        p = products.setdefault((r.item_name, r.unit), {
            "item_name": r.item_name, "item_name_ar": r.item_name_ar, "unit": r.unit,
            "by_branch": {}, "total_qty": 0.0, "total_amount": 0.0,
        })
        if not p["item_name_ar"] and r.item_name_ar:
            p["item_name_ar"] = r.item_name_ar
        cell = p["by_branch"].setdefault(bid, {"qty": 0.0, "amount": 0.0})
        cell["qty"] += qty
        cell["amount"] += amount
        p["total_qty"] += qty
        p["total_amount"] += amount
    for p in products.values():
        p["total_qty"] = round(p["total_qty"], 3)
        p["total_amount"] = round(p["total_amount"], 3)
        for cell in p["by_branch"].values():
            cell["qty"] = round(cell["qty"], 3)
            cell["amount"] = round(cell["amount"], 3)
    used = sorted({r.requesting_branch_id for r in rows},
                  key=lambda bid: branch_by_id[bid].name if bid in branch_by_id else "")
    branches = [{
        "branch_id": bid,
        "branch_name": branch_by_id[bid].name if bid in branch_by_id else "",
        "branch_name_ar": (branch_by_id[bid].name_ar or "") if bid in branch_by_id else "",
        "total_amount": round(sum(p["by_branch"].get(bid, {}).get("amount", 0) for p in products.values()), 3),
    } for bid in used]
    return {
        "branches": branches,
        "products": sorted(products.values(), key=lambda p: (p["item_name"] or "").lower()),
        "total_amount": round(sum(p["total_amount"] for p in products.values()), 3),
    }


@router.get("/product-summary")
def product_consumption_summary(brand_id: Optional[int] = None, branch_id: Optional[int] = None,
                                branch_ids: Optional[str] = None,
                                start_date: Optional[str] = None, end_date: Optional[str] = None,
                                db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Dispatched qty/amount per item, broken down by receiving branch."""
    return _product_consumption(db, user, brand_id, start_date, end_date, branch_id, branch_ids)


def _fmt_qty(v: float) -> str:
    return f"{v:.3f}".rstrip("0").rstrip(".") if v else "-"


@router.get("/product-summary/{fmt}")
def export_product_consumption(fmt: str, brand_id: Optional[int] = None, branch_id: Optional[int] = None,
                               branch_ids: Optional[str] = None,
                               start_date: Optional[str] = None, end_date: Optional[str] = None,
                               item_name: Optional[str] = None, unit: Optional[str] = None,
                               lang: str = "en", db: Session = Depends(get_db),
                               user: User = Depends(get_current_user)):
    data = _product_consumption(db, user, brand_id, start_date, end_date, branch_id, branch_ids)
    is_ar = lang == "ar"
    period = f"{start_date or '...'} - {end_date or '...'}" if (start_date or end_date) else ("كل الفترات" if is_ar else "All dates")
    if item_name:
        p = next((x for x in data["products"] if x["item_name"] == item_name and (unit is None or x["unit"] == unit)), None)
        if not p:
            raise HTTPException(404, "Item not found")
        name = (p["item_name_ar"] or p["item_name"]) if is_ar else p["item_name"]
        header = (["الفرع", "الكمية", "الوحدة", "متوسط السعر", "المبلغ", "النسبة %"] if is_ar
                  else ["Branch", "Qty", "Unit", "Avg. Price", "Amount", "Share %"])
        rows = []
        for b in sorted(data["branches"], key=lambda b: -p["by_branch"].get(b["branch_id"], {}).get("qty", 0)):
            c = p["by_branch"].get(b["branch_id"])
            if not c:
                continue
            bname = (b["branch_name_ar"] or b["branch_name"]) if is_ar else b["branch_name"]
            share = c["qty"] / p["total_qty"] * 100 if p["total_qty"] else 0
            rows.append([bname, _fmt_qty(c["qty"]), p["unit"], f"{(c['amount'] / c['qty']) if c['qty'] else 0:.3f}",
                         f"{c['amount']:.3f}", f"{share:.1f}"])
        avg = p["total_amount"] / p["total_qty"] if p["total_qty"] else 0
        rows.append(["الإجمالي" if is_ar else "Total", _fmt_qty(p["total_qty"]), p["unit"], f"{avg:.3f}",
                     f"{p['total_amount']:.3f}", "100"])
        title = (f"استهلاك الصنف حسب الفرع: {name} ({period})" if is_ar
                 else f"Branch Consumption: {name} ({period})")
        return _respond(fmt, header, rows, "product_consumption_item", title, summary_rows=1, lang=lang)
    branch_names = [(b["branch_name_ar"] or b["branch_name"]) if is_ar else b["branch_name"] for b in data["branches"]]
    if is_ar:
        header = ["الصنف", "الوحدة", *branch_names, "إجمالي الكمية", "متوسط السعر", "إجمالي المبلغ"]
    else:
        header = ["Item", "Unit", *branch_names, "Total Qty", "Avg. Price", "Total Amount"]
    rows = []
    for p in data["products"]:
        name = (p["item_name_ar"] or p["item_name"]) if is_ar else p["item_name"]
        avg = p["total_amount"] / p["total_qty"] if p["total_qty"] else 0
        rows.append([name, p["unit"],
                     *[_fmt_qty(p["by_branch"].get(b["branch_id"], {}).get("qty", 0)) for b in data["branches"]],
                     _fmt_qty(p["total_qty"]), f"{avg:.3f}", f"{p['total_amount']:.3f}"])
    rows.append(["إجمالي المبلغ" if is_ar else "Total Amount", "",
                 *[f"{b['total_amount']:.3f}" for b in data["branches"]], "", "", f"{data['total_amount']:.3f}"])
    title = f"استهلاك الأصناف حسب الفرع ({period})" if is_ar else f"Product-wise Consumption by Branch ({period})"
    return _respond(fmt, header, rows, "product_consumption", title, summary_rows=1, lang=lang)

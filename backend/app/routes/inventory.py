"""Inventory and costing: the item master (raw and semi-processed items for both brands), the Central
Kitchen's batch recipes and production, opening stock, dish cost and expected-vs-actual usage."""
import json
from collections import defaultdict
from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Form, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.branch import Branch
from app.models.inventory import (OpeningStock, OpeningStockLine, ProductionOrder, ProductionOrderLine, ProductionRecipe,
                                  ProductionRecipeLine, StockItem, StockItemPos)
from app.models.pos import PosBranchMapping
from app.models.purchase import Supplier, SupplierItem
from app.models.transfer import TransferItem
from app.models.user import User
from app.utils import pos_stock, pos_sync, units
from app.utils.auth import get_current_user

router = APIRouter(prefix="/api/inventory", tags=["inventory"])

KINDS = ("raw", "semi")
UNITS = ("g", "kg", "ml", "l", "piece")
MANAGERS = ("owner", "manager", "accountant", "purchase_manager")


def _manager(user: User) -> None:
    if user.role not in MANAGERS:
        raise HTTPException(403, "Only owner, manager, accountant or purchase manager can do this")


def _at_unit(user: User, branch_id: int) -> None:
    if user.role not in MANAGERS and user.branch_id != branch_id:
        raise HTTPException(403, "Not allowed for this unit")


def _client(db: Session):
    s = pos_sync.get_settings(db)
    return pos_sync.client_for(s) if pos_sync.is_configured(s) else None


def _need_client(db: Session):
    c = _client(db)
    if c is None:
        raise HTTPException(400, "The POS is not set up (Settings -> POS)")
    return c


def _lines(raw: str) -> list[dict]:
    try:
        rows = json.loads(raw or "[]")
        return [{"stock_item_id": int(r["stock_item_id"]), "quantity": float(r["quantity"]),
                 "unit_cost": float(r.get("unit_cost") or 0)} for r in rows if float(r.get("quantity") or 0) > 0]
    except (json.JSONDecodeError, KeyError, TypeError, ValueError):
        raise HTTPException(400, "Invalid lines")


def _d(v: Optional[str]) -> Optional[date]:
    return date.fromisoformat(v) if v else None


def item_out(it: StockItem, linked: set[int], with_recipe: set[int]) -> dict:
    return {"id": it.id, "code": it.code or "", "name": it.name, "name_ar": it.name_ar or "", "kind": it.kind,
            "category": it.category, "unit": it.unit, "is_active": bool(it.is_active), "in_pos": it.id in linked,
            "has_recipe": it.id in with_recipe}


# ------------------------------------------------------------------ item master
@router.get("/items")
def list_items(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    linked = {i for (i,) in db.query(StockItemPos.stock_item_id).all()}
    with_recipe = {i for (i,) in db.query(ProductionRecipe.stock_item_id).all()}
    rows = db.query(StockItem).order_by(StockItem.kind, StockItem.name).all()
    return [item_out(it, linked, with_recipe) for it in rows]


def _check_item(kind: str, category: str, unit: str) -> None:
    if kind not in KINDS or category not in pos_stock.CATEGORIES or unit not in UNITS:
        raise HTTPException(400, "Invalid kind, category or unit")


def _sync_one(db: Session, it: StockItem) -> Optional[str]:
    c = _client(db)
    if c is None:
        return "The POS is not set up"
    try:
        return pos_stock.sync_items(db, c, [it]).get("error")
    except Exception as e:  # noqa: BLE001
        return str(e)[:200]


@router.post("/items")
def create_item(code: str = Form(""), name: str = Form(...), name_ar: str = Form(""), kind: str = Form("raw"),
                category: str = Form("food"), unit: str = Form("kg"),
                db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _manager(user)
    _check_item(kind, category, unit)
    if code and db.query(StockItem).filter(StockItem.code == code.strip()).first():
        raise HTTPException(400, "This code is already used")
    it = StockItem(code=code.strip() or None, name=name.strip(), name_ar=name_ar.strip() or None, kind=kind,
                   category=category, unit=unit, is_active=1)
    db.add(it)
    db.commit()
    error = _sync_one(db, it)
    return {**item_out(it, {i for (i,) in db.query(StockItemPos.stock_item_id).all()}, set()), "pos_error": error}


@router.put("/items/{item_id}")
def update_item(item_id: int, code: str = Form(""), name: str = Form(...), name_ar: str = Form(""),
                kind: str = Form("raw"), category: str = Form("food"), unit: str = Form("kg"),
                is_active: bool = Form(True), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _manager(user)
    _check_item(kind, category, unit)
    it = db.get(StockItem, item_id)
    if not it:
        raise HTTPException(404, "Item not found")
    in_pos = db.query(StockItemPos).filter(StockItemPos.stock_item_id == it.id).first() is not None
    if in_pos and unit != it.unit:
        raise HTTPException(400, "The unit can't change once the item is in the POS: stock and recipes are counted in it")
    if code and db.query(StockItem).filter(StockItem.code == code.strip(), StockItem.id != it.id).first():
        raise HTTPException(400, "This code is already used")
    it.code, it.name, it.name_ar = code.strip() or None, name.strip(), name_ar.strip() or None
    it.kind, it.category, it.unit, it.is_active = kind, category, unit, 1 if is_active else 0
    db.commit()
    return {"ok": True, "pos_error": _sync_one(db, it)}


@router.post("/items/sync")
def sync_all(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _manager(user)
    return pos_stock.sync_items(db, _need_client(db))


@router.get("/sources")
def list_sources(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    """Supplier items and Central Kitchen transfer items, and the item master entry each one is."""
    sup = dict(db.query(Supplier.id, Supplier.name).all())
    rows = [{"source": "supplier_item", "id": i.id, "name": i.item_name, "name_ar": i.item_name_ar or "",
             "group": sup.get(i.supplier_id, ""), "unit": " ".join(x for x in (i.packaging, i.unit) if x),
             "price": round(i.unit_price or 0, 3), "stock_item_id": i.stock_item_id, "factor": i.stock_factor or 1}
            for i in db.query(SupplierItem).filter(SupplierItem.is_active == True).order_by(SupplierItem.item_name).all()]  # noqa: E712
    rows += [{"source": "transfer_item", "id": i.id, "name": i.name, "name_ar": i.name_ar or "", "group": "",
              "unit": i.unit or "", "price": round(i.unit_price or 0, 3), "stock_item_id": i.stock_item_id,
              "factor": i.stock_factor or 1}
             for i in db.query(TransferItem).filter(TransferItem.is_active == True).order_by(TransferItem.name).all()]  # noqa: E712
    return rows


@router.post("/sources")
def link_source(source: str = Form(...), id: int = Form(...), stock_item_id: int = Form(0), factor: float = Form(1),
                db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _manager(user)
    row = db.get(SupplierItem if source == "supplier_item" else TransferItem, id)
    if source not in ("supplier_item", "transfer_item") or not row:
        raise HTTPException(404, "Item not found")
    if stock_item_id and not db.get(StockItem, stock_item_id):
        raise HTTPException(404, "Item master entry not found")
    if factor <= 0:
        raise HTTPException(400, "The factor must be more than zero")
    row.stock_item_id, row.stock_factor = stock_item_id or None, factor
    if source == "transfer_item" and stock_item_id:
        row.category = db.get(StockItem, stock_item_id).category
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ batch recipes (semi-processed items)
def recipe_out(db: Session, r: ProductionRecipe) -> dict:
    lines = db.query(ProductionRecipeLine).filter(ProductionRecipeLine.recipe_id == r.id).all()
    return {"id": r.id, "stock_item_id": r.stock_item_id, "batch_qty": r.batch_qty, "notes": r.notes or "",
            "lines": [{"stock_item_id": ln.stock_item_id, "quantity": ln.quantity} for ln in lines]}


@router.get("/recipes")
def list_recipes(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    return [recipe_out(db, r) for r in db.query(ProductionRecipe).filter(ProductionRecipe.is_active == 1).all()]


@router.post("/recipes")
def save_recipe(stock_item_id: int = Form(...), batch_qty: float = Form(...), notes: str = Form(""),
                lines: str = Form("[]"), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _manager(user)
    out = db.get(StockItem, stock_item_id)
    if not out or out.kind != "semi":
        raise HTTPException(400, "A batch recipe is for a semi-processed item")
    if batch_qty <= 0:
        raise HTTPException(400, "The batch must make more than zero")
    rows = _lines(lines)
    if not rows or any(r["stock_item_id"] == stock_item_id or not db.get(StockItem, r["stock_item_id"]) for r in rows):
        raise HTTPException(400, "Add the ingredients (an item can't be made from itself)")
    r = db.query(ProductionRecipe).filter(ProductionRecipe.stock_item_id == stock_item_id).first()
    if not r:
        r = ProductionRecipe(stock_item_id=stock_item_id)
        db.add(r)
        db.flush()
    r.batch_qty, r.notes, r.is_active = batch_qty, notes or None, 1
    db.query(ProductionRecipeLine).filter(ProductionRecipeLine.recipe_id == r.id).delete()
    for ln in rows:
        db.add(ProductionRecipeLine(recipe_id=r.id, stock_item_id=ln["stock_item_id"], quantity=ln["quantity"]))
    db.commit()
    return recipe_out(db, r)


@router.delete("/recipes/{recipe_id}")
def delete_recipe(recipe_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _manager(user)
    r = db.get(ProductionRecipe, recipe_id)
    if r:
        r.is_active = 0
        db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ production (Central Kitchen)
def production_out(db: Session, o: ProductionOrder) -> dict:
    lines = db.query(ProductionOrderLine).filter(ProductionOrderLine.order_id == o.id).all()
    push = pos_stock.PosStockPush
    p = db.query(push).filter(push.key == f"production:{o.id}").first()
    return {"id": o.id, "branch_id": o.branch_id, "date": o.date.isoformat(), "stock_item_id": o.stock_item_id,
            "batches": o.batches, "expected_qty": o.expected_qty, "output_qty": o.output_qty,
            "yield_pct": round(o.output_qty / o.expected_qty * 100, 1) if o.expected_qty else None,
            "cost": o.cost, "unit_cost": o.unit_cost, "notes": o.notes or "",
            "status": p.status if p else "not_sent", "error": p.error if p else None,
            "lines": [{"stock_item_id": ln.stock_item_id, "quantity": ln.quantity, "cost": ln.cost} for ln in lines]}


@router.get("/production")
def list_production(date_from: Optional[str] = None, date_to: Optional[str] = None,
                    db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    q = db.query(ProductionOrder)
    if date_from:
        q = q.filter(ProductionOrder.date >= _d(date_from))
    if date_to:
        q = q.filter(ProductionOrder.date <= _d(date_to))
    return [production_out(db, o) for o in q.order_by(ProductionOrder.date.desc(), ProductionOrder.id.desc()).limit(500).all()]


@router.post("/production")
def create_production(branch_id: int = Form(...), date_: str = Form(..., alias="date"), recipe_id: int = Form(...),
                      batches: float = Form(1), output_qty: float = Form(...), notes: str = Form(""),
                      db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Ingredients for the batches leave the kitchen's stock; output_qty is what was actually made."""
    _at_unit(user, branch_id)
    unit = db.get(Branch, branch_id)
    if not unit or unit.unit_type != units.CENTRAL_KITCHEN:
        raise HTTPException(400, "Production is entered at the Central Kitchen")
    r = db.get(ProductionRecipe, recipe_id)
    if not r or not r.is_active:
        raise HTTPException(404, "Recipe not found")
    if batches <= 0 or output_qty <= 0:
        raise HTTPException(400, "Batches and quantity made must be more than zero")
    if not db.query(PosBranchMapping).filter(PosBranchMapping.local_branch_id == branch_id).first():
        raise HTTPException(400, "Link the Central Kitchen to a POS branch first (Settings -> POS)")
    rlines = db.query(ProductionRecipeLine).filter(ProductionRecipeLine.recipe_id == r.id).all()
    missing = [ln.stock_item_id for ln in rlines + [r] if not pos_stock.item_pos(db, unit.brand_id, ln.stock_item_id)]
    if missing:
        raise HTTPException(400, "Some items are not in the POS yet: sync the item master first")
    o = ProductionOrder(branch_id=branch_id, date=_d(date_) or date.today(), recipe_id=r.id, stock_item_id=r.stock_item_id,
                        batches=batches, expected_qty=round(r.batch_qty * batches, 3), output_qty=round(output_qty, 3),
                        notes=notes or None, created_by=user.id)
    db.add(o)
    db.flush()
    for ln in rlines:
        db.add(ProductionOrderLine(order_id=o.id, stock_item_id=ln.stock_item_id, quantity=round(ln.quantity * batches, 3)))
    db.flush()
    if pos_stock.queue_production(db, o):
        pos_sync.request_sync()
    db.commit()
    return production_out(db, o)


# ------------------------------------------------------------------ opening stock
@router.get("/opening")
def list_opening(db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    out = []
    for op in db.query(OpeningStock).order_by(OpeningStock.date.desc(), OpeningStock.id.desc()).all():
        lines = db.query(OpeningStockLine).filter(OpeningStockLine.opening_id == op.id).all()
        out.append({"id": op.id, "branch_id": op.branch_id, "date": op.date.isoformat(), "notes": op.notes or "",
                    "value": round(sum(ln.quantity * ln.unit_cost for ln in lines), 3),
                    "lines": [{"stock_item_id": ln.stock_item_id, "quantity": ln.quantity, "unit_cost": ln.unit_cost}
                              for ln in lines]})
    return out


@router.post("/opening")
def create_opening(branch_id: int = Form(...), date_: str = Form(..., alias="date"), notes: str = Form(""),
                   lines: str = Form("[]"), db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _manager(user)
    unit = db.get(Branch, branch_id)
    if not unit or unit.unit_type not in units.STOCK_UNITS:
        raise HTTPException(400, "Opening stock is for a sales branch, central store or the Central Kitchen")
    rows = _lines(lines)
    if not rows:
        raise HTTPException(400, "Add the counted items")
    op = OpeningStock(branch_id=branch_id, date=_d(date_) or date.today(), notes=notes or None, created_by=user.id)
    db.add(op)
    db.flush()
    for ln in rows:
        db.add(OpeningStockLine(opening_id=op.id, stock_item_id=ln["stock_item_id"], quantity=ln["quantity"],
                                unit_cost=ln["unit_cost"]))
    db.flush()
    if pos_stock.queue_opening(db, op):
        pos_sync.request_sync()
    db.commit()
    return {"id": op.id}


# ------------------------------------------------------------------ reports
def _names(db: Session, client) -> dict[str, dict]:
    code_of = {m.pos_ingredient_id: m.stock_item_id for m in db.query(StockItemPos).all()}
    items = {i.id: i for i in db.query(StockItem).all()}
    out = {}
    for i in client.ingredients().get("ingredients", []):
        it = items.get(code_of.get(i["id"]))
        out[i["id"]] = {"name": i["name"]["en"], "name_ar": i["name"]["ar"], "unit": i["unit"],
                        "cost": float(i["costPerUnit"]), "code": it.code if it and it.code else "",
                        "kind": it.kind if it else "raw"}
    return out


@router.get("/dish-costs")
def dish_costs(brand_id: int, db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    """Each dish's recipe cost at today's average cost, and its food cost % of the selling price."""
    client = _need_client(db)
    pos_brand = pos_stock.pos_brands(db, client).get(brand_id)
    names = _names(db, client)

    def costed(recipe: list[dict]) -> tuple[list[dict], float]:
        lines = []
        for ln in recipe:
            n = names.get(ln["ingredientId"], {"name": "?", "name_ar": "?", "unit": "", "cost": 0, "code": "", "kind": "raw"})
            q = float(ln["quantity"])
            lines.append({**n, "quantity": q, "line_cost": round(q * n["cost"], 3)})
        return lines, round(sum(x["line_cost"] for x in lines), 3)

    rows = []
    for item in client.get("/accounting/recipes").get("items", []):
        if item["brandId"] != pos_brand:
            continue
        lines, cost = costed(item["recipe"])
        price = float(item["price"])
        mods = []
        for m in item["modifiers"]:
            if m["recipe"]:
                ml, mc = costed(m["recipe"])
                mods.append({"name": m["name"], "price": float(m["price"]), "cost": mc, "lines": ml})
        rows.append({"id": item["id"], "name": item["name"], "category": item["category"], "price": price,
                     "cost": cost, "margin": round(price - cost, 3),
                     "food_cost_pct": round(cost / price * 100, 1) if price else None,
                     "has_recipe": bool(lines), "lines": lines, "modifiers": mods})
    return {"rows": rows}


@router.get("/usage")
def usage(brand_id: int, date_from: str, date_to: str, branch_id: Optional[int] = None,
          db: Session = Depends(get_db), _: User = Depends(get_current_user)):
    """Expected usage (recipes of what was sold, and Central Kitchen production) against actual usage
    (expected plus waste and count differences), per unit and item, in quantity and cost."""
    client = _need_client(db)
    d1, d2 = _d(date_from), _d(date_to)
    if not d1 or not d2 or d2 < d1:
        raise HTTPException(400, "Invalid dates")
    local_of = {m.pos_branch_id: m.local_branch_id for m in db.query(PosBranchMapping).all()}
    unit_rows = {b.id: b for b in db.query(Branch).filter(Branch.brand_id == brand_id).all()}
    names = _names(db, client)
    agg: dict[tuple, dict] = defaultdict(lambda: defaultdict(float))
    start = d1
    while start <= d2:
        end = min(start + timedelta(days=30), d2)
        for c in client.stock_costs(start, end).get("costs", []):
            bid = local_of.get(c["branchId"])
            if bid not in unit_rows or (branch_id and bid != branch_id):
                continue
            a = agg[(bid, c["ingredientId"])]
            a[f"{c['kind']}_qty"] += float(c["quantity"])
            a[f"{c['kind']}_cost"] += float(c["cost"])
        start = end + timedelta(days=1)
    rows = []
    for (bid, ing), a in agg.items():
        n = names.get(ing, {"name": "?", "name_ar": "?", "unit": "", "code": "", "kind": "raw"})
        exp_q, exp_c = a["sold_qty"] + a["used_in_production_qty"], a["sold_cost"] + a["used_in_production_cost"]
        var_q, var_c = a["waste_qty"] + a["count_qty"], a["waste_cost"] + a["count_cost"]
        b = unit_rows[bid]
        rows.append({"branch_id": bid, "branch": b.name, "branch_ar": b.name_ar or b.name, "code": n["code"],
                     "name": n["name"], "name_ar": n["name_ar"], "unit": n["unit"],
                     "sold_qty": round(a["sold_qty"], 3), "production_qty": round(a["used_in_production_qty"], 3),
                     "expected_qty": round(exp_q, 3), "waste_qty": round(a["waste_qty"], 3),
                     "count_qty": round(a["count_qty"], 3), "actual_qty": round(exp_q + var_q, 3),
                     "expected_cost": round(exp_c, 3), "variance_cost": round(var_c, 3),
                     "actual_cost": round(exp_c + var_c, 3),
                     "variance_pct": round(var_c / exp_c * 100, 1) if exp_c else None})
    rows.sort(key=lambda r: (r["branch"], -abs(r["variance_cost"]), r["name"]))
    return {"rows": rows}

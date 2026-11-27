"""Stock between Mudawwarah and the POS. Purchases are entered here: goods received at a branch or
a central store, and transfers sent and received, are posted into the POS stock (each once, by key).
The POS sends back what each branch used up (recipes sold, waste, counts), valued at movement cost."""
import json
from collections import defaultdict
from datetime import date, datetime, timezone

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.models.pos import PosBranchMapping, PosStockCost, PosStockLink, PosStockPush
from app.models.procurement import ProcOrder, ProcOrderItem
from app.models.purchase import PurchaseOrder, ReceivingItem, ReceivingOrder, SupplierItem
from app.models.transfer import TransferItem, TransferOrder, TransferOrderLine
from app.models.inventory import (OpeningStock, OpeningStockLine, ProductionOrder, ProductionOrderLine, StockItem,
                                  StockItemPos)

CATEGORIES = ("food", "beverage", "packaging")


def _pos_branch(db: Session, local_id: int | None) -> str | None:
    m = db.query(PosBranchMapping).filter(PosBranchMapping.local_branch_id == local_id).first() if local_id else None
    return m.pos_branch_id if m else None


def item_pos(db: Session, brand_id: int | None, stock_item_id: int | None) -> tuple[str, str] | None:
    """(POS ingredient id, category) of an item master entry in a brand."""
    if not brand_id or not stock_item_id:
        return None
    item = db.get(StockItem, stock_item_id)
    m = db.query(StockItemPos).filter(StockItemPos.brand_id == brand_id, StockItemPos.stock_item_id == stock_item_id).first()
    return (m.pos_ingredient_id, item.category) if item and m else None


def _link(db: Session, brand_id: int | None, source: str, item_id: int | None) -> PosStockLink | None:
    """The POS stock item a supplier or transfer item is: through the item master, else a direct link.
    The returned link is never added to the session."""
    if not brand_id or not item_id:
        return None
    row = db.get(SupplierItem if source == "supplier_item" else TransferItem, item_id)
    if row is not None and row.stock_item_id:
        found = item_pos(db, brand_id, row.stock_item_id)
        if found:
            return PosStockLink(brand_id=brand_id, source=source, item_id=item_id, pos_ingredient_id=found[0],
                                factor=row.stock_factor or 1, category=found[1])
    return db.query(PosStockLink).filter(PosStockLink.brand_id == brand_id, PosStockLink.source == source,
                                         PosStockLink.item_id == item_id).first()


def _line(link: PosStockLink, qty: float, unit_price: float | None) -> dict | None:
    factor = link.factor or 1
    quantity = round((qty or 0) * factor, 3)
    if quantity <= 0:
        return None
    line = {"ingredientId": link.pos_ingredient_id, "quantity": f"{quantity:.3f}"}
    if unit_price:
        line["unitCost"] = f"{round(unit_price / factor, 3):.3f}"
    return line


def _queue(db: Session, key: str, local_branch: int | None, kind: str, lines: list, note: str) -> bool:
    lines = [ln for ln in lines if ln]
    pos_branch = _pos_branch(db, local_branch)
    if not lines or not pos_branch or db.query(PosStockPush).filter(PosStockPush.key == key).first():
        return False
    body = {"key": key, "branchId": pos_branch, "kind": kind, "note": note[:500], "lines": lines}
    db.add(PosStockPush(key=key, payload=json.dumps(body)))
    return True


def queue_branch_receipt(db: Session, po: PurchaseOrder, ro: ReceivingOrder) -> bool:
    branch = db.get(Branch, po.branch_id)
    if not branch:
        return False
    catalog = {(i.item_name or "").strip().lower(): i.id for i in
               db.query(SupplierItem).filter(SupplierItem.supplier_id == po.supplier_id).all()}
    lines = []
    for ri in db.query(ReceivingItem).filter(ReceivingItem.receiving_order_id == ro.id).all():
        link = _link(db, branch.brand_id, "supplier_item", catalog.get((ri.item_name or "").strip().lower()))
        if link:
            lines.append(_line(link, ri.received_qty, ri.unit_price))
    return _queue(db, f"branch_receipt:{ro.id}", branch.id, "received", lines, f"Branch purchase #{po.id}")


def central_store(db: Session, brand_id: int) -> Branch | None:
    return db.query(Branch).filter(Branch.brand_id == brand_id, Branch.unit_type == "central_store",
                                   Branch.is_active == True).order_by(Branch.id).first()  # noqa: E712


def queue_central_receipt(db: Session, o: ProcOrder) -> bool:
    store = central_store(db, o.brand_id)
    if not store:
        return False
    lines = []
    for it in db.query(ProcOrderItem).filter(ProcOrderItem.order_id == o.id).all():
        link = _link(db, o.brand_id, "supplier_item", it.supplier_item_id)
        if link:
            lines.append(_line(link, it.received_qty if it.received_qty is not None else it.quantity, it.unit_price))
    return _queue(db, f"central_receipt:{o.id}", store.id, "received", lines, f"Central purchase {o.po_no or o.id}")


def queue_transfer(db: Session, order: TransferOrder, stage: str) -> bool:
    """stage: dispatched (leaves the source) or received (reaches the requesting unit)."""
    src, dst = db.get(Branch, order.source_branch_id), db.get(Branch, order.requesting_branch_id)
    if not src or not dst:
        return False
    unit = src if stage == "dispatched" else dst
    # Between the two companies the goods are bought by the receiving brand.
    kind = "transfer_out" if stage == "dispatched" else ("transfer_in" if src.brand_id == dst.brand_id else "received")
    lines = []
    for ln in db.query(TransferOrderLine).filter(TransferOrderLine.transfer_order_id == order.id).all():
        link = _link(db, unit.brand_id, "transfer_item", ln.item_id)
        sent = ln.dispatched_qty if ln.dispatched_qty is not None else ln.requested_qty
        qty = sent if stage == "dispatched" else (ln.received_qty if ln.received_qty is not None else sent)
        if link:
            lines.append(_line(link, qty, ln.unit_price))
    return _queue(db, f"transfer_{stage}:{order.id}", unit.id, kind, lines, f"Transfer #{order.id} {src.name} -> {dst.name}")


def _queue_post(db: Session, key: str, path: str, body: dict) -> bool:
    if db.query(PosStockPush).filter(PosStockPush.key == key).first():
        return False
    db.add(PosStockPush(key=key, path=path, payload=json.dumps({"key": key, **body})))
    return True


def category_map(db: Session, brand_id: int | None = None) -> dict[str, str]:
    """POS ingredient id -> food / beverage / packaging."""
    q = db.query(PosStockLink)
    if brand_id:
        q = q.filter(PosStockLink.brand_id == brand_id)
    cats = {ln.pos_ingredient_id: ln.category for ln in q.all()}
    q = db.query(StockItemPos.pos_ingredient_id, StockItem.category).join(StockItem, StockItem.id == StockItemPos.stock_item_id)
    if brand_id:
        q = q.filter(StockItemPos.brand_id == brand_id)
    cats.update(dict(q.all()))
    return cats


def queue_production(db: Session, order: ProductionOrder) -> bool:
    """A Central Kitchen batch: its ingredients leave the kitchen's stock and the prepared item comes in."""
    unit = db.get(Branch, order.branch_id)
    pos_branch = _pos_branch(db, order.branch_id)
    out = item_pos(db, unit.brand_id if unit else None, order.stock_item_id)
    if not unit or not pos_branch or not out:
        return False
    inputs = []
    for ln in db.query(ProductionOrderLine).filter(ProductionOrderLine.order_id == order.id).all():
        found = item_pos(db, unit.brand_id, ln.stock_item_id)
        if found and ln.quantity > 0:
            inputs.append({"ingredientId": found[0], "quantity": f"{round(ln.quantity, 3):.3f}"})
    if not inputs:
        return False
    return _queue_post(db, f"production:{order.id}", "/accounting/production", {
        "branchId": pos_branch, "outputIngredientId": out[0], "outputQuantity": f"{round(order.output_qty, 3):.3f}",
        "inputs": inputs, "note": f"Production #{order.id}"})


def queue_opening(db: Session, opening: OpeningStock) -> bool:
    unit = db.get(Branch, opening.branch_id)
    lines = []
    for ln in db.query(OpeningStockLine).filter(OpeningStockLine.opening_id == opening.id).all():
        found = item_pos(db, unit.brand_id if unit else None, ln.stock_item_id)
        if found and ln.quantity > 0:
            lines.append({"ingredientId": found[0], "quantity": f"{round(ln.quantity, 3):.3f}",
                          "unitCost": f"{round(ln.unit_cost or 0, 3):.3f}"})
    return _queue(db, f"opening_stock:{opening.id}", opening.branch_id, "received", lines, f"Opening stock #{opening.id}")


def queue_invoice_difference(db: Session, o: ProcOrder, invoice_id: int, invoice_total: float) -> bool:
    """A central purchase invoice that differs from what was received: the difference is spread over the
    received lines by value and corrects the stock cost in the POS."""
    store = central_store(db, o.brand_id)
    pos_branch = _pos_branch(db, store.id) if store else None
    items = db.query(ProcOrderItem).filter(ProcOrderItem.order_id == o.id).all()
    received = sum(it.received_total or 0 for it in items)
    diff = round((invoice_total or 0) - received, 3)
    if not pos_branch or received <= 0 or abs(diff) < 0.0005:
        return False
    lines, left = [], diff
    linked = [(it, _link(db, o.brand_id, "supplier_item", it.supplier_item_id)) for it in items if (it.received_total or 0) > 0]
    linked = [(it, ln) for it, ln in linked if ln]
    for n, (it, ln) in enumerate(linked):
        amount = left if n == len(linked) - 1 and len(linked) == len([i for i in items if (i.received_total or 0) > 0]) \
            else round(diff * (it.received_total or 0) / received, 3)
        left = round(left - amount, 3)
        qty = round((it.received_qty or 0) * (ln.factor or 1), 3)
        if qty > 0 and abs(amount) >= 0.0005:
            lines.append({"ingredientId": ln.pos_ingredient_id, "receivedQuantity": f"{qty:.3f}", "amount": f"{amount:.3f}"})
    if not lines:
        return False
    return _queue_post(db, f"revalue:proc_invoice:{invoice_id}", "/accounting/revalue", {
        "branchId": pos_branch, "lines": lines, "note": f"Invoice price, central purchase {o.po_no or o.id}"})


def price_transfer(db: Session, order: TransferOrder, client) -> None:
    """Value each line at the sender's average cost in the POS (kept as entered if the POS can't be read)."""
    src = db.get(Branch, order.source_branch_id)
    if not src or client is None:
        return
    try:
        costs = {i["id"]: float(i["costPerUnit"]) for i in client.ingredients().get("ingredients", [])}
    except Exception:  # noqa: BLE001
        return
    for ln in db.query(TransferOrderLine).filter(TransferOrderLine.transfer_order_id == order.id).all():
        link = _link(db, src.brand_id, "transfer_item", ln.item_id)
        cost = costs.get(link.pos_ingredient_id) if link else None
        if cost:
            ln.unit_price = round(cost * (link.factor or 1), 3)


def _after_push(db: Session, p: PosStockPush, res: dict) -> None:
    if p.key.startswith("production:"):
        order = db.get(ProductionOrder, int(p.key.split(":")[1]))
        if order:
            order.cost, order.unit_cost = float(res.get("cost") or 0), float(res.get("unitCost") or 0)
            per = {i["ingredientId"]: float(i["cost"]) for i in res.get("inputs", [])}
            unit = db.get(Branch, order.branch_id)
            for ln in db.query(ProductionOrderLine).filter(ProductionOrderLine.order_id == order.id).all():
                found = item_pos(db, unit.brand_id if unit else None, ln.stock_item_id)
                if found:
                    ln.cost = per.get(found[0])


def push_pending(db: Session, client) -> dict:
    sent = failed = 0
    for p in db.query(PosStockPush).filter(PosStockPush.status != "done").order_by(PosStockPush.id).all():
        try:
            res = client.post(p.path or "/accounting/stock", json.loads(p.payload)) or {}
            if p.path:
                p.result = json.dumps(res)
                _after_push(db, p, res)
            p.status, p.error, p.pushed_at = "done", None, datetime.now(timezone.utc).replace(tzinfo=None)
            sent += 1
        except Exception as e:  # noqa: BLE001 — kept for the next run, with the reason shown
            p.status, p.error = "error", str(e)[:500]
            failed += 1
        db.commit()
    return {"stock_posted": sent, "stock_failed": failed}


def apply_costs(db: Session, costs: list[dict], d_from: date, d_to: date) -> int:
    branch_map = {m.pos_branch_id: m.local_branch_id for m in db.query(PosBranchMapping).all()}
    category_of = category_map(db)
    totals: dict[tuple, float] = defaultdict(float)
    for c in costs:
        local = branch_map.get(c["branchId"])
        if not local or c["kind"] not in ("sold", "waste", "count"):
            continue
        cat = category_of.get(c["ingredientId"], "food")
        totals[(local, date.fromisoformat(c["businessDate"]), cat, c["kind"])] += float(c["cost"])
    if branch_map:
        db.query(PosStockCost).filter(PosStockCost.branch_id.in_(set(branch_map.values())),
                                      PosStockCost.date >= d_from, PosStockCost.date <= d_to).delete(synchronize_session=False)
    for (bid, d, cat, kind), cost in totals.items():
        if round(cost, 3):
            db.add(PosStockCost(branch_id=bid, date=d, category=cat, kind=kind, cost=round(cost, 3)))
    db.commit()
    return len(totals)


def unlinked_count(db: Session) -> int:
    linked = {i for (i,) in db.query(PosStockLink.item_id).filter(PosStockLink.source == "supplier_item").all()}
    return sum(1 for (i, s) in db.query(SupplierItem.id, SupplierItem.stock_item_id).all() if not s and i not in linked)


SALE_SYSTEM_FIELDS = ("cash", "knet", "link", "wamd", "talabat", "keeta", "jahez", "other", "snoonu", "website")


def stock_report(db: Session, brand_id: int, d_from: date, d_to: date, client=None) -> dict:
    """Stock on hand per unit (from the POS) and food cost against POS sales per sales branch."""
    from sqlalchemy import func
    from app.models.sale import Sale
    from app.utils import units

    unit_rows = db.query(Branch).filter(Branch.brand_id == brand_id, Branch.unit_type.in_(units.STOCK_UNITS)).all()
    by_id = {b.id: b for b in unit_rows}
    stock: dict[int, dict] = {}
    stock_error = None
    if client is not None:
        local_of = {m.pos_branch_id: m.local_branch_id for m in db.query(PosBranchMapping).all()}
        cat_of = category_map(db, brand_id)
        try:
            for row in client.stock_on_hand().get("stock", []):
                bid = local_of.get(row["branchId"])
                if bid not in by_id:
                    continue
                s = stock.setdefault(bid, {c: 0.0 for c in CATEGORIES})
                s[cat_of.get(row["ingredientId"], "food")] += float(row["value"])
        except Exception as e:  # noqa: BLE001 — the food cost part still shows
            stock_error = str(e)[:200]

    sales = dict(db.query(Sale.branch_id, func.sum(sum(getattr(Sale, f"foodics_{f}") for f in SALE_SYSTEM_FIELDS)))
                 .filter(Sale.date >= d_from, Sale.date <= d_to).group_by(Sale.branch_id).all())
    costs: dict[int, dict] = {}
    for c in db.query(PosStockCost).filter(PosStockCost.date >= d_from, PosStockCost.date <= d_to).all():
        k = costs.setdefault(c.branch_id, {"sold": 0.0, "waste": 0.0, "count": 0.0})
        k[c.kind] = k.get(c.kind, 0.0) + (c.cost or 0)

    rows = []
    for b in sorted(unit_rows, key=lambda x: (units.STOCK_UNITS.index(x.unit_type), x.name)):
        s = stock.get(b.id, {c: 0.0 for c in CATEGORIES})
        k = costs.get(b.id, {"sold": 0.0, "waste": 0.0, "count": 0.0})
        sold_total = float(sales.get(b.id) or 0)
        rows.append({
            "branch_id": b.id, "name": b.name, "name_ar": b.name_ar, "unit_type": b.unit_type,
            "stock": {c: round(v, 3) for c, v in s.items()}, "stock_value": round(sum(s.values()), 3),
            "sales": round(sold_total, 3), "cost_sold": round(k["sold"], 3), "waste": round(k["waste"], 3),
            "count_difference": round(k["count"], 3),
            "food_cost_pct": round(k["sold"] / sold_total * 100, 1) if sold_total else None,
        })
    return {"rows": rows, "stock_error": stock_error}


def pos_brands(db: Session, client) -> dict[int, str]:
    """Mudawwarah brand id -> POS brand id, through the linked branches."""
    brand_of_branch = {br["id"]: b["id"] for b in client.structure().get("brands", []) for br in b.get("branches", [])}
    out: dict[int, str] = {}
    for m in db.query(PosBranchMapping).all():
        local = db.get(Branch, m.local_branch_id)
        if local and local.brand_id and m.pos_branch_id in brand_of_branch:
            out.setdefault(local.brand_id, brand_of_branch[m.pos_branch_id])
    return out


def sync_items(db: Session, client, items: list[StockItem] | None = None) -> dict:
    """Make each item master entry a POS stock item in every brand (and keep its name and state there)."""
    brands = pos_brands(db, client)
    done = failed = 0
    error = None
    for it in items if items is not None else db.query(StockItem).all():
        for local, pos_brand in brands.items():
            m = db.query(StockItemPos).filter(StockItemPos.brand_id == local, StockItemPos.stock_item_id == it.id).first()
            if not m and not it.is_active:
                continue
            body = {"brandId": pos_brand, "name": {"en": it.name[:120], "ar": (it.name_ar or "")[:120]}, "unit": it.unit,
                    "isActive": bool(it.is_active)}
            if m:
                body["id"] = m.pos_ingredient_id
            try:
                res = client.post("/accounting/ingredients", body)
            except Exception as e:  # noqa: BLE001 — shown, and retried on the next sync
                failed, error = failed + 1, str(e)[:200]
                continue
            if not m:
                db.add(StockItemPos(brand_id=local, stock_item_id=it.id, pos_ingredient_id=res["id"]))
            done += 1
    db.commit()
    return {"synced": done, "failed": failed, "error": error}

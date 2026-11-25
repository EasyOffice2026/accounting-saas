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
from app.models.transfer import TransferOrder, TransferOrderLine

CATEGORIES = ("food", "beverage", "packaging")


def _pos_branch(db: Session, local_id: int | None) -> str | None:
    m = db.query(PosBranchMapping).filter(PosBranchMapping.local_branch_id == local_id).first() if local_id else None
    return m.pos_branch_id if m else None


def _link(db: Session, brand_id: int | None, source: str, item_id: int | None) -> PosStockLink | None:
    if not brand_id or not item_id:
        return None
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


def push_pending(db: Session, client) -> dict:
    sent = failed = 0
    for p in db.query(PosStockPush).filter(PosStockPush.status != "done").order_by(PosStockPush.id).all():
        try:
            client.post("/accounting/stock", json.loads(p.payload))
            p.status, p.error, p.pushed_at = "done", None, datetime.now(timezone.utc).replace(tzinfo=None)
            sent += 1
        except Exception as e:  # noqa: BLE001 — kept for the next run, with the reason shown
            p.status, p.error = "error", str(e)[:500]
            failed += 1
        db.commit()
    return {"stock_posted": sent, "stock_failed": failed}


def apply_costs(db: Session, costs: list[dict], d_from: date, d_to: date) -> int:
    branch_map = {m.pos_branch_id: m.local_branch_id for m in db.query(PosBranchMapping).all()}
    category_of = {ln.pos_ingredient_id: ln.category for ln in db.query(PosStockLink).all()}
    totals: dict[tuple, float] = defaultdict(float)
    for c in costs:
        local = branch_map.get(c["branchId"])
        if not local:
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
    return db.query(func.count(SupplierItem.id)).scalar() - db.query(func.count(func.distinct(PosStockLink.item_id))).filter(
        PosStockLink.source == "supplier_item").scalar()

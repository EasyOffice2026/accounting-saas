import secrets
import hmac
import hashlib
"""Brings the POS into Mudawwarah: each branch's day fills the Sales system figures, and goods
received in the POS become branch (cash) purchases. The branch still closes its physical figures."""
import logging
import threading
import time
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models.pos import PosSettings, PosBranchMapping, PosPaymentMapping, PosReceipt
from app.models.purchase import PurchaseItem, PurchaseOrder, Supplier
from app.models.sale import Sale

CHANNELS = ["cash", "knet", "link", "wamd", "talabat", "keeta", "jahez", "snoonu", "website", "other"]
CANCEL_CHANNELS = ["cash", "knet", "link", "talabat", "keeta", "jahez", "snoonu", "website"]
CHANNEL_KEYWORDS = {
    "cash": "cash", "knet": "knet", "k-net": "knet", "link": "link", "card": "link", "visa": "link",
    "master": "link", "credit": "link", "wamd": "wamd", "talabat": "talabat", "keeta": "keeta",
    "jahez": "jahez", "snoonu": "snoonu", "website": "website", "tap": "website", "online": "website",
}
MAX_RANGE_DAYS = 31
INTERVAL_SECONDS = 900
COALESCE_SECONDS = 2
NOTICE_DAYS = 7
_wake = threading.Event()
KUWAIT = ZoneInfo("Asia/Kuwait")
log = logging.getLogger("pos")


def get_settings(db: Session) -> PosSettings:
    s = db.query(PosSettings).first()
    if not s:
        s = PosSettings()
        db.add(s)
        db.commit()
        db.refresh(s)
    return s


def is_configured(s: PosSettings | None) -> bool:
    return bool(s and s.api_url and s.api_key)


def guess_channel(*names: str) -> str | None:
    for name in names:
        low = (name or "").lower()
        for word, channel in CHANNEL_KEYWORDS.items():
            if word in low:
                return channel
    return None


class PosClient:
    def __init__(self, api_url: str, api_key: str, transport: httpx.BaseTransport | None = None):
        self.base = api_url.rstrip("/")
        self.headers = {"Authorization": f"Bearer {api_key}", "Accept": "application/json"}
        self.transport = transport

    def get(self, path: str, **params) -> dict:
        with httpx.Client(timeout=30, transport=self.transport) as client:
            res = client.get(f"{self.base}{path}", headers=self.headers, params=params or None)
        if res.status_code == 401:
            raise PosError("The POS refused the integration key")
        if res.status_code >= 400:
            raise PosError(f"POS error {res.status_code}: {res.text[:200]}")
        return res.json()

    def structure(self) -> dict:
        return self.get("/accounting/structure")

    def days(self, d_from: date, d_to: date) -> dict:
        return self.get("/accounting/days", **{"from": d_from.isoformat(), "to": d_to.isoformat()})

    def receipts(self, d_from: date, d_to: date) -> dict:
        return self.get("/accounting/goods-receipts", **{"from": d_from.isoformat(), "to": d_to.isoformat()})


class PosError(Exception):
    pass


def client_for(s: PosSettings, transport: httpx.BaseTransport | None = None) -> PosClient:
    if not is_configured(s):
        raise PosError("The POS is not set up. Enter its address and integration key in Settings.")
    return PosClient(s.api_url, s.api_key, transport)


def _chunks(d_from: date, d_to: date):
    start = d_from
    while start <= d_to:
        end = min(d_to, start + timedelta(days=MAX_RANGE_DAYS - 1))
        yield start, end
        start = end + timedelta(days=1)


def _money(value) -> Decimal:
    return Decimal(str(value or 0))


def apply_days(db: Session, days: list[dict], d_from: date, d_to: date, user_id: int | None = None) -> dict:
    branch_map = {m.pos_branch_id: m.local_branch_id for m in db.query(PosBranchMapping).all()}
    method_map = {m.pos_method: m.local_channel for m in db.query(PosPaymentMapping).all()}
    unmapped_branches, unmapped_methods = set(), set()
    created = updated = 0
    seen: set[tuple[int, date]] = set()

    totals: dict[tuple[int, date], tuple[dict, dict]] = {}
    for day in days:
        local_bid = branch_map.get(day["branchId"])
        if not local_bid:
            unmapped_branches.add(day["branchId"])
            continue
        key = (local_bid, date.fromisoformat(day["businessDate"]))
        sales, cancelled = totals.setdefault(
            key, ({c: Decimal(0) for c in CHANNELS}, {c: Decimal(0) for c in CANCEL_CHANNELS}))
        for line in day.get("payments", []):
            channel = method_map.get(line["method"])
            if channel in sales:
                sales[channel] += _money(line["amount"])
            else:
                unmapped_methods.add(line["method"])
        for line in day.get("refunds", []):
            channel = method_map.get(line["method"])
            if channel in cancelled:
                cancelled[channel] += _money(line["amount"])
            else:
                unmapped_methods.add(line["method"])

    for (local_bid, day_date), (sales, cancelled) in totals.items():
        seen.add((local_bid, day_date))
        sale = db.query(Sale).filter(Sale.branch_id == local_bid, Sale.date == day_date).first()
        if not sale:
            sale = Sale(branch_id=local_bid, date=day_date, created_by=user_id, notes="From the POS")
            db.add(sale)
            created += 1
        else:
            updated += 1
        for c, v in sales.items():
            setattr(sale, f"foodics_{c}", float(round(v, 3)))
        for c, v in cancelled.items():
            setattr(sale, f"cancelled_{c}", float(round(v, 3)))

    # A day the POS no longer reports (every order voided) must not keep old system figures.
    mapped = set(branch_map.values())
    if mapped:
        stale = db.query(Sale).filter(Sale.branch_id.in_(mapped), Sale.date >= d_from, Sale.date <= d_to).all()
        for sale in stale:
            if (sale.branch_id, sale.date) in seen:
                continue
            for c in CHANNELS:
                setattr(sale, f"foodics_{c}", 0)
            for c in CANCEL_CHANNELS:
                setattr(sale, f"cancelled_{c}", 0)

    db.commit()
    return {
        "days_created": created,
        "days_updated": updated,
        "unmapped_branches": sorted(unmapped_branches),
        "unmapped_methods": sorted(unmapped_methods),
    }


def apply_receipts(db: Session, receipts: list[dict], user_id: int | None = None) -> dict:
    branch_map = {m.pos_branch_id: m.local_branch_id for m in db.query(PosBranchMapping).all()}
    booked = 0
    for r in receipts:
        if db.query(PosReceipt).filter(PosReceipt.pos_receipt_id == r["id"]).first():
            continue
        local_bid = branch_map.get(r["branchId"])
        if not local_bid:
            continue
        name = (r.get("supplier") or {}).get("name") or "POS supplier"
        supplier = db.query(Supplier).filter(func.lower(Supplier.name) == name.strip().lower()).first()
        if not supplier:
            supplier = Supplier(name=name.strip(), payment_type="cash")
            db.add(supplier)
            db.flush()
        total = float(round(_money(r["total"]), 3))
        label = f"POS goods receipt {r.get('number', '')}".strip()
        if r.get("invoiceNumber"):
            label += f" / invoice {r['invoiceNumber']}"
        po = PurchaseOrder(
            branch_id=local_bid, supplier_id=supplier.id,
            date=date.fromisoformat(r["businessDate"]), payment_type="cash",
            total_amount=total, status="received", notes=label, created_by=user_id,
        )
        db.add(po)
        db.flush()
        db.add(PurchaseItem(purchase_order_id=po.id, item_name=label, quantity=1, unit="lot",
                            unit_price=total, total=total))
        db.add(PosReceipt(pos_receipt_id=r["id"], purchase_order_id=po.id, total=total))
        booked += 1
    db.commit()
    return {"receipts_booked": booked}


def sync(db: Session, d_from: date, d_to: date, user_id: int | None = None,
         transport: httpx.BaseTransport | None = None) -> dict:
    if d_to < d_from:
        raise PosError("The end date is before the start date")
    s = get_settings(db)
    client = client_for(s, transport)
    result = {"days_created": 0, "days_updated": 0, "receipts_booked": 0,
              "unmapped_branches": set(), "unmapped_methods": set()}
    try:
        for start, end in _chunks(d_from, d_to):
            r = apply_days(db, client.days(start, end).get("days", []), start, end, user_id)
            result["days_created"] += r["days_created"]
            result["days_updated"] += r["days_updated"]
            result["unmapped_branches"].update(r["unmapped_branches"])
            result["unmapped_methods"].update(r["unmapped_methods"])
            if s.import_receipts:
                rr = apply_receipts(db, client.receipts(start, end).get("receipts", []), user_id)
                result["receipts_booked"] += rr["receipts_booked"]
    except (PosError, httpx.HTTPError) as e:
        db.rollback()
        s.last_error = str(e) or e.__class__.__name__
        db.commit()
        raise PosError(s.last_error) from e
    s.last_sync_at = datetime.now(timezone.utc).replace(tzinfo=None)
    s.last_error = None
    db.commit()
    result["unmapped_branches"] = sorted(result["unmapped_branches"])
    result["unmapped_methods"] = sorted(result["unmapped_methods"])
    return result


def kuwait_today() -> date:
    return datetime.now(KUWAIT).date()


def webhook_secret(db: Session, s: PosSettings) -> str:
    if not s.webhook_secret:
        s.webhook_secret = secrets.token_urlsafe(32)
        db.commit()
    return s.webhook_secret


def signature_ok(secret: str | None, body: bytes, signature: str) -> bool:
    if not secret or not signature:
        return False
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature.strip().lower())


def request_sync():
    """Called when the POS says something changed; the worker syncs within seconds."""
    _wake.set()


def _loop():
    while True:
        woke = _wake.wait(INTERVAL_SECONDS)
        if woke:
            time.sleep(COALESCE_SECONDS)  # one sync for a burst of notices
            _wake.clear()
        db = SessionLocal()
        try:
            s = db.query(PosSettings).first()
            if is_configured(s) and s.auto_sync:
                today = kuwait_today()
                # A refund can change an older day, so a notice looks a week back.
                sync(db, today - timedelta(days=NOTICE_DAYS - 1 if woke else 1), today)
        except Exception:
            db.rollback()
            log.exception("POS sync failed")
        finally:
            db.close()


def start_pos_autosync():
    threading.Thread(target=_loop, name="pos-autosync", daemon=True).start()

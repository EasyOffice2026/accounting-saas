"""Sales Proceeds — non-cash daily sales (KNET, Link, Talabat, Keeta, Jahez, Snoonu) due from providers.

Each day's branch-posted physical sales per method become an amount due. It stays outstanding until a
receipt is recorded: the net amount received is credited to a payment channel (bank) and the provider's
commission / fees are recorded with it. Only sales and receipts from CHANNEL_START_DATE count.
Cash sales are not part of this module (they belong to the branch cash boxes).
"""
from fastapi import APIRouter, Depends, HTTPException, Form, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import date, timedelta
from typing import Optional

from app.database import get_db
from app.models.proceeds import ProceedsReceipt, ProceedsChannelMap, PROCEEDS_METHODS, METHOD_LABELS
from app.models.channel import PaymentChannel
from app.models.sale import Sale
from app.models.branch import Branch
from app.models.hr import Brand
from app.models.user import User
from app.utils.auth import get_current_user
from app.routes.channels import CHANNEL_START_DATE, MANAGE_ROLES, _channel_or_404

router = APIRouter(prefix="/api/proceeds", tags=["sales-proceeds"])

SALE_COLS = {
    "knet": Sale.physical_knet, "link": Sale.physical_link, "talabat": Sale.physical_talabat,
    "keeta": Sale.physical_keeta, "jahez": Sale.physical_jahez, "snoonu": Sale.physical_snoonu,
}
AGE_BUCKETS = (("0_7", 0, 7), ("8_15", 8, 15), ("16_30", 16, 30), ("31_plus", 31, None))


def _guard(user: User):
    if user.role not in MANAGE_ROLES:
        raise HTTPException(403, "Only management / accountant can access sales proceeds")


def _method(method: str) -> str:
    if method not in PROCEEDS_METHODS:
        raise HTTPException(400, "Invalid sales method")
    return method


def _label(method: str, lang: str) -> str:
    en, ar = METHOD_LABELS[method]
    return ar if lang == "ar" else en


def _parse(d: Optional[str]) -> Optional[date]:
    return date.fromisoformat(d) if d else None


def _brand_ids(db: Session, user: User, brand_id: Optional[int]) -> list:
    allowed = user.get_allowed_brands()
    if brand_id:
        if allowed is not None and brand_id not in allowed:
            raise HTTPException(403, "Brand not allowed")
        return [brand_id]
    if allowed is not None:
        return list(allowed)
    return [b.id for b in db.query(Brand.id).all()]


def _scope(db: Session, user: User, brand_id: Optional[int], branch_id: Optional[int]):
    """Return (brand ids, branch ids) the request may see."""
    brands = _brand_ids(db, user, brand_id)
    bids = [b.id for b in db.query(Branch.id).filter(Branch.brand_id.in_(brands)).all()]
    if branch_id:
        if branch_id not in bids:
            raise HTTPException(403, "Branch not in the selected brand")
        bids = [branch_id]
    return brands, bids


def _sales_sum(db: Session, bids: list, d_from: Optional[date], d_to: Optional[date]) -> dict:
    q = db.query(*[func.coalesce(func.sum(SALE_COLS[m]), 0) for m in PROCEEDS_METHODS]).filter(
        Sale.branch_id.in_(bids), Sale.date >= max(d_from or CHANNEL_START_DATE, CHANNEL_START_DATE))
    if d_to:
        q = q.filter(Sale.date <= d_to)
    return dict(zip(PROCEEDS_METHODS, [float(v) for v in q.one()]))


def _receipts_q(db: Session, brands: list, branch_id: Optional[int]):
    q = db.query(ProceedsReceipt).filter(
        ProceedsReceipt.brand_id.in_(brands), ProceedsReceipt.date >= CHANNEL_START_DATE)
    if branch_id:
        q = q.filter(ProceedsReceipt.branch_id == branch_id)
    return q


def _receipts_sum(db: Session, brands: list, branch_id: Optional[int], d_from: Optional[date], d_to: Optional[date]) -> dict:
    q = db.query(ProceedsReceipt.method, func.coalesce(func.sum(ProceedsReceipt.amount), 0),
                 func.coalesce(func.sum(ProceedsReceipt.fees), 0)).filter(
        ProceedsReceipt.brand_id.in_(brands), ProceedsReceipt.date >= CHANNEL_START_DATE)
    if branch_id:
        q = q.filter(ProceedsReceipt.branch_id == branch_id)
    if d_from:
        q = q.filter(ProceedsReceipt.date >= d_from)
    if d_to:
        q = q.filter(ProceedsReceipt.date <= d_to)
    out = {m: (0.0, 0.0) for m in PROCEEDS_METHODS}
    for m, amt, fees in q.group_by(ProceedsReceipt.method).all():
        if m in out:
            out[m] = (float(amt), float(fees))
    return out


def _channel_map(db: Session, brand_id: Optional[int]) -> dict:
    if not brand_id:
        return {}
    return {r.method: r.channel_id for r in db.query(ProceedsChannelMap).filter(ProceedsChannelMap.brand_id == brand_id).all()}


def _summary(db: Session, user: User, brand_id: Optional[int], branch_id: Optional[int],
             date_from: Optional[str], date_to: Optional[str]) -> dict:
    brands, bids = _scope(db, user, brand_id, branch_id)
    d_from = max(_parse(date_from) or CHANNEL_START_DATE, CHANNEL_START_DATE)
    d_to = _parse(date_to) or date.today()
    before = d_from - timedelta(days=1)
    open_sales = _sales_sum(db, bids, None, before) if d_from > CHANNEL_START_DATE else {m: 0.0 for m in PROCEEDS_METHODS}
    open_rec = _receipts_sum(db, brands, branch_id, None, before) if d_from > CHANNEL_START_DATE else {m: (0.0, 0.0) for m in PROCEEDS_METHODS}
    sales = _sales_sum(db, bids, d_from, d_to)
    rec = _receipts_sum(db, brands, branch_id, d_from, d_to)
    cmap = _channel_map(db, brand_id)
    rows = []
    for m in PROCEEDS_METHODS:
        opening = open_sales[m] - open_rec[m][0] - open_rec[m][1]
        received, fees = rec[m]
        rows.append({
            "method": m, "label": METHOD_LABELS[m][0], "label_ar": METHOD_LABELS[m][1],
            "opening": round(opening, 3), "sales": round(sales[m], 3), "received": round(received, 3),
            "fees": round(fees, 3), "outstanding": round(opening + sales[m] - received - fees, 3),
            "channel_id": cmap.get(m),
        })
    totals = {k: round(sum(r[k] for r in rows), 3) for k in ("opening", "sales", "received", "fees", "outstanding")}

    branch_rows = (
        db.query(Branch.id, Branch.name, Branch.name_ar,
                 *[func.coalesce(func.sum(SALE_COLS[m]), 0) for m in PROCEEDS_METHODS])
        .join(Sale, Sale.branch_id == Branch.id)
        .filter(Branch.id.in_(bids), Sale.date >= d_from, Sale.date <= d_to)
        .group_by(Branch.id, Branch.name, Branch.name_ar).order_by(Branch.name).all()
    )
    by_branch = []
    for r in branch_rows:
        vals = {m: round(float(v), 3) for m, v in zip(PROCEEDS_METHODS, r[3:])}
        by_branch.append({"branch_id": r[0], "branch": r[1], "branch_ar": r[2] or r[1], **vals,
                          "total": round(sum(vals.values()), 3)})
    return {"date_from": str(d_from), "date_to": str(d_to), "start_date": str(CHANNEL_START_DATE),
            "rows": rows, "totals": totals, "by_branch": by_branch}


def _statement(db: Session, user: User, method: str, brand_id: Optional[int], branch_id: Optional[int],
               date_from: Optional[str], date_to: Optional[str]) -> dict:
    brands, bids = _scope(db, user, brand_id, branch_id)
    col = SALE_COLS[method]
    d_from = max(_parse(date_from) or CHANNEL_START_DATE, CHANNEL_START_DATE)
    d_to = _parse(date_to) or date.today()
    names = {b.id: (b.name, b.name_ar or b.name) for b in db.query(Branch).filter(Branch.id.in_(bids)).all()}

    entries = []
    sale_rows = (
        db.query(Sale.date, Sale.branch_id, func.coalesce(func.sum(col), 0))
        .filter(Sale.branch_id.in_(bids), Sale.date >= CHANNEL_START_DATE, Sale.date <= d_to)
        .group_by(Sale.date, Sale.branch_id).all()
    )
    for d, bid, amt in sale_rows:
        if float(amt) == 0:
            continue
        entries.append({"date": d, "id": f"sale-{d}-{bid}", "kind": "sales", "branch": names[bid][0],
                        "branch_ar": names[bid][1], "reference": "", "sales": round(float(amt), 3),
                        "received": 0.0, "fees": 0.0})
    channels = {c.id: c for c in db.query(PaymentChannel).all()}
    for r in _receipts_q(db, brands, branch_id).filter(ProceedsReceipt.method == method, ProceedsReceipt.date <= d_to).all():
        ch = channels.get(r.channel_id)
        bn = names.get(r.branch_id) if r.branch_id else None
        period = ""
        if r.period_from or r.period_to:
            period = f"{r.period_from or ''} → {r.period_to or ''}"
        entries.append({
            "date": r.date, "id": f"rcpt-{r.id}", "receipt_id": r.id, "kind": "receipt",
            "branch": bn[0] if bn else "", "branch_ar": bn[1] if bn else "",
            "reference": " · ".join(x for x in (r.reference or "", period, r.notes or "") if x),
            "channel": ch.name if ch else "", "channel_ar": (ch.name_ar or ch.name) if ch else "",
            "sales": 0.0, "received": round(r.amount or 0, 3), "fees": round(r.fees or 0, 3),
        })
    entries.sort(key=lambda e: (e["date"], 0 if e["kind"] == "sales" else 1, e["id"]))

    opening = 0.0
    balance = 0.0
    out = []
    for e in entries:
        balance += e["sales"] - e["received"] - e["fees"]
        if e["date"] < d_from:
            opening = balance
            continue
        out.append({**e, "date": str(e["date"]), "balance": round(balance, 3)})

    credits = sum(e["received"] + e["fees"] for e in entries)
    ageing = {k: 0.0 for k, _, _ in AGE_BUCKETS}
    for e in entries:
        if e["kind"] != "sales":
            continue
        applied = min(credits, e["sales"])
        credits -= applied
        unpaid = e["sales"] - applied
        if unpaid <= 0:
            continue
        age = (d_to - e["date"]).days
        for k, lo, hi in AGE_BUCKETS:
            if age >= lo and (hi is None or age <= hi):
                ageing[k] += unpaid
                break
    return {
        "method": method, "label": METHOD_LABELS[method][0], "label_ar": METHOD_LABELS[method][1],
        "date_from": str(d_from), "date_to": str(d_to),
        "opening": round(opening, 3),
        "total_sales": round(sum(x["sales"] for x in out), 3),
        "total_received": round(sum(x["received"] for x in out), 3),
        "total_fees": round(sum(x["fees"] for x in out), 3),
        "closing": round(out[-1]["balance"], 3) if out else round(opening, 3),
        "ageing": {k: round(v, 3) for k, v in ageing.items()},
        "entries": out,
    }


@router.get("/summary")
def summary(
    brand_id: Optional[int] = Query(None), branch_id: Optional[int] = Query(None),
    date_from: Optional[str] = Query(None), date_to: Optional[str] = Query(None),
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    _guard(user)
    return _summary(db, user, brand_id, branch_id, date_from, date_to)


@router.get("/statement/{method}")
def statement(
    method: str,
    brand_id: Optional[int] = Query(None), branch_id: Optional[int] = Query(None),
    date_from: Optional[str] = Query(None), date_to: Optional[str] = Query(None),
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    _guard(user)
    return _statement(db, user, _method(method), brand_id, branch_id, date_from, date_to)


@router.post("/receipts")
def add_receipt(
    method: str = Form(...),
    receipt_date: str = Form(...),
    channel_id: int = Form(...),
    amount: float = Form(0),
    fees: float = Form(0),
    branch_id: str = Form(""),
    period_from: str = Form(""),
    period_to: str = Form(""),
    reference: str = Form(""),
    notes: str = Form(""),
    brand_id: Optional[int] = Form(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _guard(user)
    _method(method)
    d = date.fromisoformat(receipt_date)
    if d < CHANNEL_START_DATE:
        raise HTTPException(400, f"Receipts can only be recorded from {CHANNEL_START_DATE}")
    if amount < 0 or fees < 0 or amount + fees <= 0:
        raise HTTPException(400, "Enter the amount received and/or fees")
    bid = int(branch_id) if branch_id.strip().isdigit() else None
    if bid:
        br = db.query(Branch).filter(Branch.id == bid).first()
        if not br:
            raise HTTPException(404, "Branch not found")
        brand_id = br.brand_id
    if not brand_id:
        raise HTTPException(400, "Select a brand")
    _brand_ids(db, user, brand_id)
    ch = _channel_or_404(db, channel_id)
    if not ch.is_active:
        raise HTTPException(400, "Payment channel is inactive")
    if ch.brand_id and ch.brand_id != brand_id:
        raise HTTPException(400, "Payment channel belongs to another brand")
    r = ProceedsReceipt(
        brand_id=brand_id, method=method, branch_id=bid, date=d,
        period_from=_parse(period_from), period_to=_parse(period_to), channel_id=ch.id,
        amount=round(amount, 3), fees=round(fees, 3),
        reference=reference.strip() or None, notes=notes.strip() or None, created_by=user.id,
    )
    db.add(r)
    db.commit()
    return {"id": r.id}


@router.delete("/receipts/{receipt_id}")
def delete_receipt(receipt_id: int, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    _guard(user)
    r = db.query(ProceedsReceipt).filter(ProceedsReceipt.id == receipt_id).first()
    if not r:
        raise HTTPException(404, "Receipt not found")
    _brand_ids(db, user, r.brand_id)
    db.delete(r)
    db.commit()
    return {"status": "deleted"}


@router.put("/channels")
def set_default_channel(
    method: str = Form(...),
    channel_id: str = Form(""),
    brand_id: Optional[int] = Form(None),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    _guard(user)
    _method(method)
    if not brand_id:
        raise HTTPException(400, "Select a brand")
    _brand_ids(db, user, brand_id)
    row = db.query(ProceedsChannelMap).filter(
        ProceedsChannelMap.brand_id == brand_id, ProceedsChannelMap.method == method).first()
    if not channel_id.strip().isdigit():
        if row:
            db.delete(row)
            db.commit()
        return {"status": "cleared"}
    ch = _channel_or_404(db, int(channel_id))
    if ch.brand_id and ch.brand_id != brand_id:
        raise HTTPException(400, "Payment channel belongs to another brand")
    if row:
        row.channel_id = ch.id
    else:
        db.add(ProceedsChannelMap(brand_id=brand_id, method=method, channel_id=ch.id))
    db.commit()
    return {"status": "saved"}


def _title(db: Session, brand_id: Optional[int], base: str, lang: str) -> str:
    b = db.query(Brand).filter(Brand.id == brand_id).first() if brand_id else None
    if not b:
        return base
    return f"{base} — {(b.name_ar or b.name_en) if lang == 'ar' else b.name_en}"


@router.get("/summary/export/{fmt}")
def export_summary(
    fmt: str,
    brand_id: Optional[int] = Query(None), branch_id: Optional[int] = Query(None),
    date_from: Optional[str] = Query(None), date_to: Optional[str] = Query(None),
    lang: str = Query("en"),
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    from app.routes.export import _respond
    _guard(user)
    s = _summary(db, user, brand_id, branch_id, date_from, date_to)
    ar = lang == "ar"
    header = (["طريقة البيع", "الرصيد الافتتاحي", "المبيعات", "المستلم", "العمولة / الرسوم", "المستحق"] if ar
              else ["Sales Method", "Opening Due", "Sales", "Received", "Commission / Fees", "Outstanding"])
    data = [[_label(r["method"], lang), f"{r['opening']:.3f}", f"{r['sales']:.3f}", f"{r['received']:.3f}",
             f"{r['fees']:.3f}", f"{r['outstanding']:.3f}"] for r in s["rows"]]
    t = s["totals"]
    data.append(["الإجمالي" if ar else "TOTAL", f"{t['opening']:.3f}", f"{t['sales']:.3f}", f"{t['received']:.3f}",
                 f"{t['fees']:.3f}", f"{t['outstanding']:.3f}"])
    base = (f"متحصلات المبيعات {s['date_from']} إلى {s['date_to']}" if ar
            else f"Sales Proceeds {s['date_from']} to {s['date_to']}")
    return _respond(fmt, header, data, f"sales_proceeds_{s['date_from']}_{s['date_to']}",
                    _title(db, brand_id, base, lang), summary_rows=1, lang=lang)


@router.get("/statement/{method}/export/{fmt}")
def export_statement(
    method: str, fmt: str,
    brand_id: Optional[int] = Query(None), branch_id: Optional[int] = Query(None),
    date_from: Optional[str] = Query(None), date_to: Optional[str] = Query(None),
    lang: str = Query("en"),
    db: Session = Depends(get_db), user: User = Depends(get_current_user),
):
    from app.routes.export import _respond
    _guard(user)
    st = _statement(db, user, _method(method), brand_id, branch_id, date_from, date_to)
    ar = lang == "ar"
    header = (["التاريخ", "النوع", "الفرع", "القناة", "المرجع / ملاحظات", "المبيعات", "المستلم", "الرسوم", "الرصيد المستحق"] if ar
              else ["Date", "Type", "Branch", "Channel", "Reference / Notes", "Sales", "Received", "Fees", "Balance Due"])
    data = [[st["date_from"], "رصيد افتتاحي" if ar else "Opening Due", "", "", "", "", "", "", f"{st['opening']:.3f}"]]
    for e in st["entries"]:
        kind = ("مبيعات" if ar else "Sales") if e["kind"] == "sales" else ("استلام" if ar else "Receipt")
        data.append([
            e["date"], kind, e["branch_ar"] if ar else e["branch"],
            (e.get("channel_ar") if ar else e.get("channel")) or "", e["reference"],
            f"{e['sales']:.3f}" if e["sales"] else "", f"{e['received']:.3f}" if e["received"] else "",
            f"{e['fees']:.3f}" if e["fees"] else "", f"{e['balance']:.3f}",
        ])
    data.append(["", "الإجمالي" if ar else "TOTAL", "", "", "", f"{st['total_sales']:.3f}",
                 f"{st['total_received']:.3f}", f"{st['total_fees']:.3f}", f"{st['closing']:.3f}"])
    base = (f"كشف متحصلات {_label(method, lang)} {st['date_from']} إلى {st['date_to']}" if ar
            else f"{_label(method, lang)} Proceeds Statement {st['date_from']} to {st['date_to']}")
    return _respond(fmt, header, data, f"proceeds_{method}_{st['date_from']}_{st['date_to']}",
                    _title(db, brand_id, base, lang), summary_rows=1, lang=lang)

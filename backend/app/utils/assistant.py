"""AI reporting assistant: the model only picks a fixed report and its filters; the figures come from the database.

It never writes SQL and never changes data. Every report is limited to the branches and brands the login may see.
"""
import json
import os
from collections import defaultdict
from datetime import date, datetime
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy.orm import Session

from app.models.assistant import AssistantLog
from app.models.branch import Branch
from app.models.expense import Expense, ExpenseCategory
from app.models.hr import Brand
from app.models.procurement import ProcOrder, ProcOrderItem
from app.models.purchase import PurchaseCategory, PurchaseItem, PurchaseOrder, Supplier, SupplierItem
from app.models.sale import Sale
from app.models.user import User
from app.utils.ledger_access import can_use_accounting

OPENAI_URL = "https://api.openai.com/v1"
MODEL = os.environ.get("ASSISTANT_MODEL", "gpt-4.1-mini")
MAX_ROUNDS = 5
CHANNELS = ("cash", "knet", "link", "wamd", "talabat", "keeta", "jahez", "other", "snoonu", "website")
CANCELLED = ("cash", "knet", "link", "talabat", "keeta", "jahez", "snoonu", "website")
FULL_ROLES = ("owner", "admin", "manager", "accountant")
PURCHASED = ("received", "invoiced", "paid", "closed")


class AssistantError(Exception):
    pass


class NotAllowed(AssistantError):
    pass


def is_configured() -> bool:
    return bool(os.environ.get("OPENAI_API_KEY"))


# ---------------------------------------------------------------- what a login may see

class Scope:
    def __init__(self, db: Session, user: User):
        if user.role not in FULL_ROLES and user.role != "staff":
            raise NotAllowed("The assistant is not available for this role")
        q = db.query(Branch).filter(Branch.is_active == True)  # noqa: E712
        if user.role == "staff":
            if not user.branch_id:
                raise NotAllowed("The assistant is not available for this login")
            q = q.filter(Branch.id == user.branch_id)
        brands = user.get_allowed_brands()
        if brands is not None:
            q = q.filter(Branch.brand_id.in_(brands))
        self.branches = {b.id: b for b in q.order_by(Branch.id).all()}
        self.brand_ids = sorted({b.brand_id for b in self.branches.values() if b.brand_id})
        tabs = user.get_allowed_tabs()
        allow = lambda *keys: tabs is None or any(k in tabs for k in keys)  # noqa: E731
        self.reports = set()
        if allow("sales"):
            self.reports.add("sales_report")
        if allow("expenses"):
            self.reports.add("expense_report")
        if allow("purchases", "procurement"):
            self.reports.add("purchase_report")
        if can_use_accounting(db, user):
            self.reports.add("stock_report")
        self.central = user.role in FULL_ROLES and allow("procurement", "purchases")

    def branch_ids(self, requested=None, brand_id=None, unit_types=None) -> list[int]:
        ids = list(self.branches)
        if requested:
            bad = [i for i in requested if i not in self.branches]
            if bad:
                raise NotAllowed(f"Branch {bad[0]} is not available for this login")
            ids = list(requested)
        if brand_id:
            ids = [i for i in ids if self.branches[i].brand_id == brand_id]
        if unit_types:
            ids = [i for i in ids if self.branches[i].unit_type in unit_types]
        return ids

    def check_brand(self, brand_id):
        if brand_id and brand_id not in self.brand_ids:
            raise NotAllowed(f"Brand {brand_id} is not available for this login")


def _d(s, field):
    try:
        return date.fromisoformat(s)
    except (TypeError, ValueError):
        raise AssistantError(f"{field} must be a date like 2026-10-31")


def _r(x):
    return round(float(x or 0), 3)


def _period(o, group_by):
    return o.isoformat() if group_by == "day" else o.strftime("%Y-%m")


# ---------------------------------------------------------------- reports

def sales_report(db, scope, date_from, date_to, branch_ids=None, brand_id=None, group_by="total"):
    d1, d2 = _d(date_from, "date_from"), _d(date_to, "date_to")
    scope.check_brand(brand_id)
    ids = scope.branch_ids(branch_ids, brand_id, None if branch_ids else ("sales",))
    rows = db.query(Sale).filter(Sale.branch_id.in_(ids or [0]), Sale.date >= d1, Sale.date <= d2).all()
    groups = defaultdict(lambda: {"physical": 0.0, "system": 0.0, "cancelled": 0.0, "days": 0})
    channels = defaultdict(lambda: {"physical": 0.0, "system": 0.0})
    for s in rows:
        phys = sum(getattr(s, f"physical_{c}") or 0 for c in CHANNELS)
        sysv = sum(getattr(s, f"foodics_{c}") or 0 for c in CHANNELS)
        canc = sum(getattr(s, f"cancelled_{c}") or 0 for c in CANCELLED)
        key = {"branch": scope.branches[s.branch_id].name, "day": _period(s.date, "day"),
               "month": _period(s.date, "month")}.get(group_by, "total")
        g = groups[key]
        g["physical"] += phys
        g["system"] += sysv
        g["cancelled"] += canc
        g["days"] += 1
        for c in CHANNELS:
            channels[c]["physical"] += getattr(s, f"physical_{c}") or 0
            channels[c]["system"] += getattr(s, f"foodics_{c}") or 0
    out = {"rows": [{"group": k, "physical_sales": _r(v["physical"]), "pos_system_sales": _r(v["system"]),
                     "cancelled": _r(v["cancelled"]), "days": v["days"]} for k, v in sorted(groups.items())],
           "total_physical_sales": _r(sum(v["physical"] for v in groups.values())),
           "total_pos_system_sales": _r(sum(v["system"] for v in groups.values()))}
    if group_by == "channel":
        out["rows"] = [{"group": c, "physical_sales": _r(v["physical"]), "pos_system_sales": _r(v["system"])}
                       for c, v in channels.items() if v["physical"] or v["system"]]
    return out, {"from": d1.isoformat(), "to": d2.isoformat(), "branches": [scope.branches[i].name for i in ids]}


def expense_report(db, scope, date_from, date_to, category_ids=None, search=None, branch_ids=None,
                   brand_id=None, restaurants_only=False, group_by="total"):
    d1, d2 = _d(date_from, "date_from"), _d(date_to, "date_to")
    scope.check_brand(brand_id)
    ids = scope.branch_ids(branch_ids, brand_id, ("sales",) if restaurants_only and not branch_ids else None)
    q = db.query(Expense).filter(Expense.branch_id.in_(ids or [0]), Expense.date >= d1, Expense.date <= d2)
    if category_ids:
        q = q.filter(Expense.category_id.in_(category_ids))
    if search:
        q = q.filter(Expense.description.ilike(f"%{search}%"))
    cats = {c.id: c.name for c in db.query(ExpenseCategory).all()}
    groups = defaultdict(lambda: [0.0, 0])
    for e in q.all():
        key = {"branch": scope.branches[e.branch_id].name, "category": cats.get(e.category_id, "Uncategorised"),
               "month": _period(e.date, "month")}.get(group_by, "total")
        groups[key][0] += e.amount or 0
        groups[key][1] += 1
    filters = {"from": d1.isoformat(), "to": d2.isoformat(), "branches": [scope.branches[i].name for i in ids]}
    if category_ids:
        filters["categories"] = [cats.get(c, str(c)) for c in category_ids]
    if search:
        filters["search"] = search
    return {"rows": [{"group": k, "amount": _r(v[0]), "entries": v[1]} for k, v in sorted(groups.items())],
            "total": _r(sum(v[0] for v in groups.values()))}, filters


def purchase_report(db, scope, date_from, date_to, item=None, supplier=None, category_ids=None, branch_ids=None,
                    brand_id=None, group_by="item"):
    """Branch purchases plus received central purchases, per item and unit."""
    d1, d2 = _d(date_from, "date_from"), _d(date_to, "date_to")
    scope.check_brand(brand_id)
    ids = scope.branch_ids(branch_ids, brand_id)
    words = [w.lower() for w in (item or "").replace(",", " ").split() if w.strip()]
    sups = {s.id: s.name for s in db.query(Supplier).all()}
    sup_ids = {i for i, n in sups.items() if supplier.lower() in (n or "").lower()} if supplier else None
    catalog = {i.id: i for i in db.query(SupplierItem).all()}
    groups = defaultdict(lambda: {"quantity": 0.0, "amount": 0.0, "lines": 0})

    def matches(*names):
        text = " ".join(n for n in names if n).lower()
        return all(w in text for w in words)

    def add(key_parts, unit, qty, amount):
        g = groups[(key_parts, unit or "pcs")]
        g["quantity"] += qty or 0
        g["amount"] += amount or 0
        g["lines"] += 1

    def key(name, sup_id, where, d):
        return {"item": name, "supplier": sups.get(sup_id, ""), "branch": where,
                "month": _period(d, "month")}.get(group_by, "total")

    q = db.query(PurchaseItem, PurchaseOrder).join(PurchaseOrder, PurchaseOrder.id == PurchaseItem.purchase_order_id)\
        .filter(PurchaseOrder.branch_id.in_(ids or [0]), PurchaseOrder.date >= d1, PurchaseOrder.date <= d2)
    if category_ids:
        q = q.filter(PurchaseOrder.category_id.in_(category_ids))
    if sup_ids is not None:
        q = q.filter(PurchaseOrder.supplier_id.in_(sup_ids or [0]))
    for it, o in q.all():
        if matches(it.item_name):
            add(key(it.item_name, o.supplier_id, scope.branches[o.branch_id].name, o.date), it.unit, it.quantity, it.total)

    central = scope.central and not branch_ids
    if central:
        brands = [brand_id] if brand_id else scope.brand_ids
        q = db.query(ProcOrderItem, ProcOrder).join(ProcOrder, ProcOrder.id == ProcOrderItem.order_id)\
            .filter(ProcOrder.status.in_(PURCHASED), ProcOrder.brand_id.in_(brands or [0]),
                    ProcOrder.date >= d1, ProcOrder.date <= d2)
        if category_ids:
            q = q.filter(ProcOrder.category_id.in_(category_ids))
        if sup_ids is not None:
            q = q.filter(ProcOrder.supplier_id.in_(sup_ids or [0]))
        for it, o in q.all():
            cat = catalog.get(it.supplier_item_id)
            name = cat.item_name if cat else it.item_name
            if matches(name, it.item_name, it.item_name_ar, cat.item_name_ar if cat else None, it.packaging):
                qty = it.received_qty if it.received_qty is not None else it.quantity
                amount = it.received_total if it.received_total is not None else it.total
                add(key(name, o.supplier_id, "Central purchases", o.date), it.unit, qty, amount)
    filters = {"from": d1.isoformat(), "to": d2.isoformat(),
               "branches": [scope.branches[i].name for i in ids] + (["Central purchases"] if central else [])}
    if item:
        filters["item"] = item
    if supplier:
        filters["supplier"] = supplier
    rows = [{"group": k, "unit": u, "quantity": _r(v["quantity"]), "amount": _r(v["amount"]), "lines": v["lines"]}
            for (k, u), v in sorted(groups.items(), key=lambda x: -x[1]["amount"])]
    return {"rows": rows[:50], "total_amount": _r(sum(v["amount"] for v in groups.values()))}, filters


def stock_report(db, scope, brand_id, date_from, date_to):
    from app.utils import pos_stock, pos_sync
    d1, d2 = _d(date_from, "date_from"), _d(date_to, "date_to")
    scope.check_brand(brand_id)
    s = pos_sync.get_settings(db)
    client = pos_sync.client_for(s) if pos_sync.is_configured(s) else None
    r = pos_stock.stock_report(db, brand_id, d1, d2, client)
    rows = [x for x in r.get("rows", []) if x.get("branch_id") in scope.branches]
    return {"rows": rows, "stock_error": r.get("stock_error")}, {"from": d1.isoformat(), "to": d2.isoformat(),
                                                               "brand": brand_id}


REPORTS = {"sales_report": sales_report, "expense_report": expense_report,
           "purchase_report": purchase_report, "stock_report": stock_report}

_dates = {"date_from": {"type": "string", "description": "First day, YYYY-MM-DD"},
          "date_to": {"type": "string", "description": "Last day, YYYY-MM-DD"}}
_where = {"branch_ids": {"type": "array", "items": {"type": "integer"}, "description": "Unit ids; omit for all"},
          "brand_id": {"type": "integer", "description": "Brand id; omit for all brands"}}
TOOLS = [
    {"type": "function", "function": {
        "name": "sales_report", "description": "Sales of sales branches: physical (counted at closing) and POS system figures, KWD.",
        "parameters": {"type": "object", "required": ["date_from", "date_to"], "properties": {
            **_dates, **_where,
            "group_by": {"type": "string", "enum": ["total", "branch", "channel", "day", "month"]}}}}},
    {"type": "function", "function": {
        "name": "expense_report", "description": "Expenses (rent, utilities, salaries paid as expenses, maintenance...) by unit, KWD.",
        "parameters": {"type": "object", "required": ["date_from", "date_to"], "properties": {
            **_dates, **_where,
            "category_ids": {"type": "array", "items": {"type": "integer"}},
            "search": {"type": "string", "description": "Text in the expense description, only if no category fits"},
            "restaurants_only": {"type": "boolean", "description": "Only sales branches, not offices or stores"},
            "group_by": {"type": "string", "enum": ["total", "branch", "category", "month"]}}}}},
    {"type": "function", "function": {
        "name": "purchase_report", "description": "Quantities and amounts bought: branch purchases and received central purchases.",
        "parameters": {"type": "object", "required": ["date_from", "date_to"], "properties": {
            **_dates, **_where,
            "item": {"type": "string", "description": "Item name words in English as on invoices, e.g. 'milk'"},
            "supplier": {"type": "string"},
            "category_ids": {"type": "array", "items": {"type": "integer"}},
            "group_by": {"type": "string", "enum": ["item", "supplier", "branch", "month", "total"]}}}}},
    {"type": "function", "function": {
        "name": "stock_report", "description": "Stock on hand now (from the POS) and food cost % per unit for a brand.",
        "parameters": {"type": "object", "required": ["brand_id", "date_from", "date_to"], "properties": {
            **_dates, "brand_id": {"type": "integer"}}}}},
]


def run_report(db, scope, name, args: dict):
    if name not in REPORTS:
        raise AssistantError(f"Unknown report {name}")
    if name not in scope.reports:
        raise NotAllowed("This report is not available for this login")
    return REPORTS[name](db, scope, **args)


# ---------------------------------------------------------------- the conversation

def _system_prompt(db, scope, lang):
    now = datetime.now(ZoneInfo("Asia/Kuwait"))
    brands = {b.id: b.name_en for b in db.query(Brand).all()}
    units = "\n".join(f"- id {b.id}: {b.name}{' / ' + b.name_ar if b.name_ar else ''} "
                      f"({b.unit_type}, brand {brands.get(b.brand_id, b.brand_id)})" for b in scope.branches.values())
    ecats = "; ".join(f"{c.id}={c.name}{'/' + c.name_ar if c.name_ar else ''}"
                      for c in db.query(ExpenseCategory).filter(ExpenseCategory.is_active == True))  # noqa: E712
    pcats = "; ".join(f"{c.id}={c.name}" for c in db.query(PurchaseCategory).all())
    return f"""You are the reporting assistant of a restaurant group in Kuwait (Mudawwarah system).
Today is {now.date().isoformat()} ({now.strftime('%A')}), Kuwait time. Money is KWD: always write amounts with exactly 3 decimals, e.g. 3.750 KWD.
Answer only from the reports you call. Never guess or estimate a figure; if a report has no data, say so.
You cannot change any data. If asked to, say you can only read reports.
Resolve dates yourself: "last month" is the previous calendar month; "this month" is the 1st to today.
"Restaurants" or "branches" means sales units. Units the user may see:
{units}
Brands: {"; ".join(f"{i}={n}" for i, n in brands.items() if i in scope.brand_ids)}
Expense categories: {ecats}
Purchase categories: {pcats}
Reports available: {", ".join(sorted(scope.reports)) or "none"}.
Sales: use physical sales as the sales figure, and mention the POS system figure when it differs.
Reply in {"Arabic (Kuwaiti dialect is fine)" if lang == "ar" else "the language of the question"}, short and clear,
with each figure and the dates and branches it covers. Use plain text, no tables, no markdown."""


def _openai(path, body, transport=None, timeout=60):
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        raise AssistantError("The AI assistant is not set up: no OpenAI key")
    with httpx.Client(transport=transport, timeout=timeout) as c:
        r = c.post(f"{OPENAI_URL}{path}", json=body, headers={"Authorization": f"Bearer {key}"})
    if r.status_code != 200:
        try:
            msg = r.json()["error"]["message"]
        except (ValueError, KeyError, TypeError):
            msg = r.text[:200]
        raise AssistantError(f"AI service error {r.status_code}: {msg}")
    return r.json()


def ask(db: Session, user: User, question: str, history=None, lang="en", channel="app", transport=None) -> dict:
    question = (question or "").strip()[:2000]
    if not question:
        raise AssistantError("Please type a question")
    scope = Scope(db, user)
    messages = [{"role": "system", "content": _system_prompt(db, scope, lang)}]
    for m in (history or [])[-6:]:
        if m.get("role") in ("user", "assistant") and m.get("content"):
            messages.append({"role": m["role"], "content": str(m["content"])[:2000]})
    messages.append({"role": "user", "content": question})
    tools = [t for t in TOOLS if t["function"]["name"] in scope.reports]
    used, answer, error = [], None, None
    try:
        for _ in range(MAX_ROUNDS):
            body = {"model": MODEL, "messages": messages}
            if tools:
                body["tools"] = tools
            if not MODEL.startswith("gpt-5"):
                body["temperature"] = 0
            msg = _openai("/chat/completions", body, transport)["choices"][0]["message"]
            calls = msg.get("tool_calls") or []
            if not calls:
                answer = (msg.get("content") or "").strip()
                break
            messages.append({"role": "assistant", "content": msg.get("content"), "tool_calls": calls})
            for call in calls:
                name = call["function"]["name"]
                try:
                    args = json.loads(call["function"].get("arguments") or "{}")
                    result, filters = run_report(db, scope, name, args)
                    used.append({"report": name, "filters": filters})
                    content = json.dumps({"filters": filters, **result}, ensure_ascii=False, default=str)
                except (AssistantError, TypeError, ValueError) as e:
                    content = json.dumps({"error": str(e)})
                messages.append({"role": "tool", "tool_call_id": call["id"], "content": content[:20000]})
        if answer is None:
            raise AssistantError("The question needed too many reports; please ask it more simply")
        return {"answer": answer, "reports": used}
    except AssistantError as e:
        error = str(e)
        raise
    finally:
        db.add(AssistantLog(user_id=user.id, channel=channel, question=question, answer=answer,
                            reports=json.dumps(used, ensure_ascii=False), error=error))
        db.commit()


def transcribe(data: bytes, filename: str, content_type: str, transport=None) -> str:
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        raise AssistantError("The AI assistant is not set up: no OpenAI key")
    with httpx.Client(transport=transport, timeout=60) as c:
        r = c.post(f"{OPENAI_URL}/audio/transcriptions", headers={"Authorization": f"Bearer {key}"},
                   data={"model": os.environ.get("ASSISTANT_STT_MODEL", "gpt-4o-mini-transcribe"),
                         "prompt": "Restaurant reports in English or Kuwaiti Arabic: sales, expenses, rent, purchases, branch names."},
                   files={"file": (filename or "voice.webm", data, content_type or "audio/webm")})
    if r.status_code != 200:
        raise AssistantError(f"Voice could not be read ({r.status_code})")
    return (r.json().get("text") or "").strip()


def speech(text: str, lang: str, transport=None) -> bytes:
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        raise AssistantError("The AI assistant is not set up: no OpenAI key")
    body = {"model": os.environ.get("ASSISTANT_TTS_MODEL", "gpt-4o-mini-tts"), "voice": "alloy",
            "input": text[:4000], "response_format": "mp3",
            "instructions": "Speak in a Kuwaiti Arabic accent, clearly." if lang == "ar" else "Speak clearly."}
    with httpx.Client(transport=transport, timeout=60) as c:
        r = c.post(f"{OPENAI_URL}/audio/speech", json=body, headers={"Authorization": f"Bearer {key}"})
    if r.status_code != 200:
        raise AssistantError(f"Voice could not be made ({r.status_code})")
    return r.content

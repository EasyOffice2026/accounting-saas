"""Derives general-ledger journals from Mudawwarah records.

Every source record (sale, expense, branch purchase, cash box entry, channel entry, proceeds receipt,
central-purchase invoice/payment, salary, staff advance) maps to one balanced journal identified by a
source_key such as "sale:123". sync_ledger() rebuilds the expected journals and compares them with the
posted ones: new sources are posted, changed sources are reversed and posted again, deleted sources are
reversed. Posted journals are never edited, so every change stays traceable."""
import hashlib
import json
from datetime import date, datetime, timedelta, timezone
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.accounting import AccAccount, AccMapping, AccJournal, AccJournalLine
from app.models.branch import Branch
from app.models.cash import CashTransaction
from app.models.channel import PaymentChannel, ChannelTransaction
from app.models.expense import Expense, ExpenseCategory
from app.models.hr import Brand, SalaryPayment, AdvanceLoan, Employee
from app.models.proceeds import ProceedsReceipt, PROCEEDS_METHODS
from app.models.procurement import ProcOrder, ProcInvoice, ProcPayment
from app.models.purchase import PurchaseOrder, PurchaseCategory, Invoice
from app.models.transfer import TransferOrder, TransferOrderLine, TransferItem
from app.models.renewal import RenewalRequest
from app.models.sale import Sale
from app.utils.chart_template import CHART_TEMPLATE
from app.utils.ledger_access import get_settings

R = 3
EPS = 0.0005

# Accounts that become headers because per-branch / per-channel sub-accounts sit under them.
SUBLEDGER_PARENTS = {"1110", "1130"}
EXTRA_ACCOUNTS = [
    ("1139", "Bank - not specified", "بنك - غير محدد", "ASSET", "bank", "1100", False, "BalancesWithBanks"),
    ("1280", "Due from related parties", "مستحق من أطراف ذات علاقة", "ASSET", "receivable", "1200", False, "OtherCurrentReceivables"),
]

SETTING_DEFAULTS = {
    "bank_default": ("1139", "Bank payments with no payment channel", "مدفوعات بنكية بدون قناة دفع"),
    "owner_account": ("3400", "Cash box top-ups / withdrawals with no payment channel", "إيداع وسحب الصندوق بدون قناة دفع"),
    "loan_paid_from": ("1139", "Staff advances paid from", "صرف سلف الموظفين من"),
    "opening_equity": ("3100", "Opening balance difference", "فرق الأرصدة الافتتاحية"),
    "sales": ("4110", "Sales", "المبيعات"),
    "salaries": ("6110", "Salaries and wages", "الرواتب والأجور"),
    "staff_advances": ("1270", "Staff advances and loans", "سلف وقروض الموظفين"),
    "suppliers": ("2110", "Suppliers (Central Purchases and credit purchases)", "الموردون"),
    "renewals": ("6230", "Personnel Office renewals", "تجديدات مكتب شؤون الموظفين"),
    "other_income": ("4900", "Other cash box receipts", "مقبوضات أخرى للصندوق"),
    "other_expense": ("6900", "Other cash box payments", "مدفوعات أخرى من الصندوق"),
    "bank_charges": ("6260", "Proceeds fees - KNET / Link", "رسوم المتحصلات - كي نت / لينك"),
    "aggregator_fees": ("5150", "Proceeds fees - delivery apps", "رسوم المتحصلات - تطبيقات التوصيل"),
    "corporate_customers": ("1260", "Sales - other payment method", "المبيعات - طريقة دفع أخرى"),
    "transfers_food": ("5110", "Internal transfers - food items", "التحويلات الداخلية - مواد غذائية"),
    "transfers_packaging": ("5130", "Internal transfers - packaging", "التحويلات الداخلية - تغليف"),
    "related_receivable": ("1280", "Internal transfers to the other company (due from)", "تحويلات للشركة الأخرى (مستحق من)"),
    "related_payable": ("2150", "Internal transfers from the other company (due to)", "تحويلات من الشركة الأخرى (مستحق إلى)"),
}

RECEIVABLE_CODES = {"knet": "1210", "link": "1220", "talabat": "1230", "keeta": "1240", "jahez": "1250", "snoonu": "1250"}
AGGREGATORS = {"talabat", "keeta", "jahez", "snoonu"}

EXPENSE_CATEGORY_DEFAULTS = [
    ("rent", "6210"), ("utilit", "6220"), ("internet", "6220"), ("salar", "6110"), ("maint", "6250"),
    ("marketing", "6240"), ("other", "6900"), ("renewal", "6230"), ("licen", "6230"),
]
PURCHASE_CATEGORY_DEFAULTS = [("packag", "5130"), ("consum", "5130"), ("equip", "6250")]
CHANNEL_START = date(2026, 10, 1)


def _r(x) -> float:
    return round(float(x or 0), R)


class Ledger:
    """Account lookup / creation for one sync run."""

    def __init__(self, db: Session):
        self.db = db
        self.by_code: dict[tuple[int, str], int] = {}
        self.by_key: dict[tuple[int, str], int] = {}
        self.maps: dict[tuple[int, str, str], int] = {}
        self.branch_brand = {b.id: b.brand_id for b in db.query(Branch).all()}
        self.branch_name = {b.id: (b.name, b.name_ar) for b in db.query(Branch).all()}
        for a in db.query(AccAccount).all():
            self.by_code[(a.brand_id, a.code)] = a.id
            if a.system_key:
                self.by_key[(a.brand_id, a.system_key)] = a.id
        for m in db.query(AccMapping).all():
            self.maps[(m.brand_id, m.kind, str(m.ref_id))] = m.account_id

    def code(self, brand_id: int, code: str) -> int:
        return self.by_code[(brand_id, code)]

    def _sub(self, brand_id: int, key: str, parent: str, code: str, name: str, name_ar: Optional[str], subtype: str) -> int:
        if (brand_id, key) in self.by_key:
            return self.by_key[(brand_id, key)]
        a = AccAccount(brand_id=brand_id, code=code, name=name, name_ar=name_ar or name, type="ASSET", subtype=subtype,
                       parent_code=parent, concept="CashOnHand" if subtype == "cash" else "BalancesWithBanks", system_key=key)
        self.db.add(a)
        self.db.flush()
        self.by_key[(brand_id, key)] = a.id
        self.by_code[(brand_id, code)] = a.id
        return a.id

    def cashbox(self, branch_id: int) -> int:
        brand = self.branch_brand[branch_id]
        n, n_ar = self.branch_name.get(branch_id, (str(branch_id), None))
        return self._sub(brand, f"cashbox:{branch_id}", "1110", f"1110-{branch_id:02d}", f"Cash box - {n}",
                         f"صندوق - {n_ar or n}", "cash")

    def channel(self, ch: PaymentChannel, brand_id: int) -> int:
        return self._sub(brand_id, f"channel:{ch.id}", "1130", f"1130-{ch.id:02d}", ch.name, ch.name_ar, "bank")

    def setting(self, brand_id: int, key: str) -> int:
        mapped = self.maps.get((brand_id, "setting", key))
        return mapped or self.code(brand_id, SETTING_DEFAULTS[key][0])

    def mapped(self, brand_id: int, kind: str, ref_id, name: str, defaults, fallback: str) -> int:
        m = self.maps.get((brand_id, kind, str(ref_id)))
        if m:
            return m
        low = (name or "").lower()
        for kw, code in defaults:
            if kw in low:
                return self.code(brand_id, code)
        return self.code(brand_id, fallback)


def ensure_chart(db: Session) -> None:
    for brand in db.query(Brand).all():
        have = {a.code for a in db.query(AccAccount).filter(AccAccount.brand_id == brand.id).all()}
        for code, en, ar, typ, sub, parent, header, concept in CHART_TEMPLATE + EXTRA_ACCOUNTS:
            if code in have:
                continue
            db.add(AccAccount(brand_id=brand.id, code=code, name=en, name_ar=ar, type=typ, subtype=sub, parent_code=parent,
                              is_header=header or code in SUBLEDGER_PARENTS, concept=concept))
    db.commit()


class Entry:
    def __init__(self, key: str, brand_id: int, d: date, description: str, source: str):
        self.key, self.brand_id, self.date, self.description, self.source = key, brand_id, d, description, source
        self.lines: list[tuple[int, Optional[int], float, float, str, Optional[str]]] = []

    def dr(self, account_id: int, amount, branch_id: Optional[int] = None, memo: str = "", party: Optional[str] = None):
        amount = _r(amount)
        if abs(amount) > EPS:
            self.lines.append((account_id, branch_id, amount, 0.0, memo, party) if amount > 0
                              else (account_id, branch_id, 0.0, -amount, memo, party))

    def cr(self, account_id: int, amount, branch_id: Optional[int] = None, memo: str = "", party: Optional[str] = None):
        self.dr(account_id, -_r(amount), branch_id, memo, party)

    def balanced(self) -> bool:
        return bool(self.lines) and abs(sum(l[2] - l[3] for l in self.lines)) < EPS

    def digest(self) -> str:
        payload = [str(self.date), self.description, sorted([list(l) for l in self.lines], key=lambda x: json.dumps(x))]
        return hashlib.sha1(json.dumps(payload, ensure_ascii=False).encode()).hexdigest()


def _channels(db: Session) -> dict[int, PaymentChannel]:
    return {c.id: c for c in db.query(PaymentChannel).all()}


def build_entries(db: Session, L: Ledger, start: date) -> list[Entry]:
    out: list[Entry] = []
    chans = _channels(db)

    def chan_acc(channel_id: Optional[int], brand_id: int) -> Optional[int]:
        ch = chans.get(channel_id) if channel_id else None
        return L.channel(ch, ch.brand_id or brand_id) if ch else None

    # Sales: physical takings per method; cash goes to the branch cash box, the rest is due from the provider.
    for s in db.query(Sale).filter(Sale.date >= start).all():
        brand = L.branch_brand.get(s.branch_id)
        if not brand:
            continue
        e = Entry(f"sale:{s.id}", brand, s.date, f"Sales {s.date:%d/%m/%Y}", "sale")
        parts = {
            "knet": s.physical_knet, "link": (s.physical_link or 0) + (s.physical_wamd or 0), "talabat": s.physical_talabat,
            "keeta": s.physical_keeta, "jahez": s.physical_jahez, "snoonu": s.physical_snoonu,
        }
        e.dr(L.cashbox(s.branch_id), s.physical_cash, s.branch_id, "Cash")
        for m, amt in parts.items():
            e.dr(L.code(brand, RECEIVABLE_CODES[m]), amt, s.branch_id, m.upper(), f"customer:{m}")
        e.dr(L.setting(brand, "corporate_customers"), s.physical_other, s.branch_id, "Other", "customer:other")
        total = sum(l[2] for l in e.lines)
        e.cr(L.setting(brand, "sales"), total, s.branch_id)
        out.append(e)

    pcats = {c.id: c.name for c in db.query(PurchaseCategory).all()}

    def purchase_acc(brand: int, cat_id: Optional[int]) -> int:
        return L.mapped(brand, "purchase_category", cat_id or 0, pcats.get(cat_id, ""), PURCHASE_CATEGORY_DEFAULTS, "5110")

    # Branch purchases: cash purchases leave the branch cash box on the order date (as in the cash box);
    # credit purchases go to suppliers when invoiced and are cleared when the invoice is paid.
    credit_po = {}
    for inv in db.query(Invoice).join(PurchaseOrder, PurchaseOrder.id == Invoice.purchase_order_id).filter(
            PurchaseOrder.date < start, Invoice.status == "paid", Invoice.paid_date >= start).all():
        brand = L.branch_brand.get(inv.branch_id)
        if not brand or (inv.paid_amount or 0) <= 0:
            continue
        p = Entry(f"purchase_invoice_pay:{inv.id}", brand, inv.paid_date, f"Purchase invoice #{inv.purchase_order_id} paid", "purchase")
        p.dr(L.setting(brand, "suppliers"), inv.paid_amount, inv.branch_id, "", f"supplier:{inv.supplier_id}")
        p.cr(L.setting(brand, "bank_default"), inv.paid_amount, inv.branch_id)
        out.append(p)
    for po in db.query(PurchaseOrder).filter(PurchaseOrder.date >= start).all():
        brand = L.branch_brand.get(po.branch_id)
        if not brand:
            continue
        if (po.payment_type or "cash") != "cash":
            credit_po[po.id] = po
            continue
        e = Entry(f"purchase:{po.id}", brand, po.date, f"Branch purchase #{po.id}", "purchase")
        e.dr(purchase_acc(brand, po.category_id), po.total_amount, po.branch_id)
        e.cr(L.cashbox(po.branch_id), po.total_amount, po.branch_id)
        out.append(e)
    if credit_po:
        for inv in db.query(Invoice).filter(Invoice.purchase_order_id.in_(list(credit_po))).all():
            po = credit_po[inv.purchase_order_id]
            brand = L.branch_brand[po.branch_id]
            e = Entry(f"purchase_invoice:{inv.id}", brand, inv.date, f"Purchase invoice #{po.id}", "purchase")
            e.dr(purchase_acc(brand, po.category_id), inv.total_amount, po.branch_id)
            e.cr(L.setting(brand, "suppliers"), inv.total_amount, po.branch_id, "", f"supplier:{inv.supplier_id}")
            out.append(e)
            if inv.status == "paid" and (inv.paid_amount or 0) > 0 and inv.paid_date:
                p = Entry(f"purchase_invoice_pay:{inv.id}", brand, inv.paid_date, f"Purchase invoice #{po.id} paid", "purchase")
                p.dr(L.setting(brand, "suppliers"), inv.paid_amount, po.branch_id, "", f"supplier:{inv.supplier_id}")
                p.cr(L.setting(brand, "bank_default"), inv.paid_amount, po.branch_id)
                out.append(p)

    # Expenses (including contract and renewal mirrors). Salary mirrors are handled with the salary.
    ecats = {c.id: c.name for c in db.query(ExpenseCategory).all()}
    renewal_box = {r.id: r.cash_txn_id for r in db.query(RenewalRequest).filter(RenewalRequest.cash_txn_id.isnot(None)).all()}
    txn_branch = {t.id: t.branch_id for t in db.query(CashTransaction).filter(CashTransaction.id.in_(list(renewal_box.values()) or [0])).all()}
    salary_exp: dict[int, Expense] = {}
    for x in db.query(Expense).filter(Expense.date >= start).all():
        if x.salary_payment_id:
            salary_exp[x.salary_payment_id] = x
            continue
        brand = L.branch_brand.get(x.branch_id)
        if not brand:
            continue
        e = Entry(f"expense:{x.id}", brand, x.date, (x.description or "Expense")[:200], "expense")
        if x.renewal_request_id:
            debit = L.maps.get((brand, "expense_category", str(x.category_id))) or L.setting(brand, "renewals")
        else:
            debit = L.mapped(brand, "expense_category", x.category_id or 0, ecats.get(x.category_id, ""), EXPENSE_CATEGORY_DEFAULTS, "6270")
        e.dr(debit, x.amount, x.branch_id)
        pm = x.payment_method or "cash"
        if pm == "cash":
            e.cr(L.cashbox(x.branch_id), x.amount, x.branch_id)
        elif pm == "personnel_petty_cash" and renewal_box.get(x.renewal_request_id) in txn_branch:
            box = txn_branch[renewal_box[x.renewal_request_id]]
            e.cr(L.cashbox(box), x.amount, box)
        else:
            e.cr(chan_acc(x.channel_id, brand) or L.setting(brand, "bank_default"), x.amount, x.branch_id)
        out.append(e)

    # Salaries: gross (net + advance deducted) to salaries; the advance part clears staff advances.
    sal_ids = list(salary_exp)
    sps = {sp.id: sp for sp in db.query(SalaryPayment).filter(SalaryPayment.id.in_(sal_ids or [0])).all()}
    emp_name = {e.id: e.name for e in db.query(Employee.id, Employee.name).all()}
    for sp_id, x in salary_exp.items():
        sp = sps.get(sp_id)
        brand = L.branch_brand.get(x.branch_id)
        if not sp or not brand:
            continue
        cc = sp.branch_id if L.branch_brand.get(sp.branch_id) == brand else x.branch_id
        e = Entry(f"salary:{sp.id}", brand, x.date, f"Salary {sp.month} - {emp_name.get(sp.employee_id, '')}"[:200], "salary")
        loan = _r(sp.loan_deduction)
        e.dr(L.setting(brand, "salaries"), _r(x.amount) + loan, cc)
        e.cr(L.setting(brand, "staff_advances"), loan, cc, "", f"employee:{sp.employee_id}")
        if (x.payment_method or "cash") == "cash":
            e.cr(L.cashbox(x.branch_id), x.amount, x.branch_id)
        else:
            e.cr(chan_acc(x.channel_id, brand) or L.setting(brand, "bank_default"), x.amount, cc)
        out.append(e)

    # Staff advances paid out.
    emp_branch = {e.id: e.branch_id for e in db.query(Employee.id, Employee.branch_id).all()}
    for ln in db.query(AdvanceLoan).filter(AdvanceLoan.date >= start, AdvanceLoan.approval_status == "approved").all():
        br = emp_branch.get(ln.employee_id)
        brand = L.branch_brand.get(br)
        if not brand:
            continue
        e = Entry(f"advance:{ln.id}", brand, ln.date, f"Staff {ln.loan_type or 'advance'} - {emp_name.get(ln.employee_id, '')}"[:200], "advance")
        e.dr(L.setting(brand, "staff_advances"), ln.amount, br, "", f"employee:{ln.employee_id}")
        e.cr(L.setting(brand, "loan_paid_from"), ln.amount, br)
        out.append(e)

    # Manual cash box entries. Entries created by Central Purchases / renewal payments are already in those journals.
    mirrored = {p.cash_txn_id for p in db.query(ProcPayment.cash_txn_id).filter(ProcPayment.cash_txn_id.isnot(None)).all()}
    mirrored |= set(renewal_box.values())
    for t in db.query(CashTransaction).filter(CashTransaction.date >= start).all():
        if t.id in mirrored or t.txn_type == "opening_balance":
            continue
        brand = L.branch_brand.get(t.branch_id)
        if not brand:
            continue
        box = L.cashbox(t.branch_id)
        other = chan_acc(t.channel_id, brand)
        e = Entry(f"cash:{t.id}", brand, t.date, f"Cash box {t.category} {t.reference or ''}".strip()[:200], "cash")
        if t.txn_type == "cash_in":
            if not other:
                other = L.setting(brand, "owner_account") if t.category == "petty_cash" else L.setting(brand, "other_income")
            e.dr(box, t.amount, t.branch_id)
            e.cr(other, t.amount, t.branch_id)
        elif t.txn_type == "cash_out":
            if not other:
                other = {"deposit": L.setting(brand, "bank_default"), "withdrawal": L.setting(brand, "owner_account")}.get(
                    t.category) or L.setting(brand, "other_expense")
            e.dr(other, t.amount, t.branch_id)
            e.cr(box, t.amount, t.branch_id)
        else:
            continue
        out.append(e)

    # Manual payment channel deposits / withdrawals.
    for t in db.query(ChannelTransaction).filter(ChannelTransaction.date >= start).all():
        ch = chans.get(t.channel_id)
        if not ch:
            continue
        brand = ch.brand_id or 1
        acc = L.channel(ch, brand)
        e = Entry(f"channel:{t.id}", brand, t.date, f"{ch.name} {t.txn_type} {t.reference or ''}".strip()[:200], "channel")
        if t.txn_type == "deposit":
            e.dr(acc, t.amount)
            e.cr(L.setting(brand, "owner_account"), t.amount)
        else:
            e.dr(L.setting(brand, "owner_account"), t.amount)
            e.cr(acc, t.amount)
        out.append(e)

    # Payment channels opened after the ledger start date.
    for ch in chans.values():
        if ch.opening_date and ch.opening_date >= start and abs(ch.opening_balance or 0) > EPS:
            brand = ch.brand_id or 1
            e = Entry(f"channel_opening:{ch.id}", brand, ch.opening_date, f"{ch.name} opening balance", "opening")
            e.dr(L.channel(ch, brand), ch.opening_balance)
            e.cr(L.setting(brand, "opening_equity"), ch.opening_balance)
            out.append(e)

    # Sales proceeds received: net to the channel, fees to expenses, clears the provider receivable.
    for r in db.query(ProceedsReceipt).filter(ProceedsReceipt.date >= start).all():
        ch = chans.get(r.channel_id)
        brand = r.brand_id
        if r.method not in RECEIVABLE_CODES:
            continue
        e = Entry(f"proceeds:{r.id}", brand, r.date, f"Sales proceeds {r.method.upper()} {r.reference or ''}".strip()[:200], "proceeds")
        e.dr(L.channel(ch, brand) if ch else L.setting(brand, "bank_default"), r.amount, r.branch_id)
        e.dr(L.setting(brand, "aggregator_fees" if r.method in AGGREGATORS else "bank_charges"), r.fees, r.branch_id)
        e.cr(L.code(brand, RECEIVABLE_CODES[r.method]), _r(r.amount) + _r(r.fees), r.branch_id, "", f"customer:{r.method}")
        out.append(e)

    # Central Purchases (Purchase Office): invoices to suppliers, payments from channel / office petty cash.
    orders = {o.id: o for o in db.query(ProcOrder).all()}
    pinv = {i.id: i for i in db.query(ProcInvoice).all()}
    for inv in pinv.values():
        if inv.date < start:
            continue
        brand = inv.brand_id
        e = Entry(f"proc_invoice:{inv.id}", brand, inv.date,
                  f"Central purchase invoice {inv.invoice_number or inv.id}"[:200], "proc_invoice")
        if inv.kind == "opening":
            e.dr(L.setting(brand, "opening_equity"), inv.total_amount)
        else:
            o = orders.get(inv.order_id)
            e.dr(purchase_acc(brand, o.category_id if o else None), inv.total_amount)
        e.cr(L.setting(brand, "suppliers"), inv.total_amount, None, "", f"supplier:{inv.supplier_id}")
        out.append(e)
    cash_box_of = {t.id: t.branch_id for t in db.query(CashTransaction.id, CashTransaction.branch_id)
                   .filter(CashTransaction.id.in_(list(mirrored) or [0])).all()}
    for p in db.query(ProcPayment).filter(ProcPayment.date >= start).all():
        inv = pinv.get(p.invoice_id)
        if not inv:
            continue
        brand = inv.brand_id
        e = Entry(f"proc_payment:{p.id}", brand, p.date, f"Supplier payment {inv.invoice_number or inv.id}"[:200], "proc_payment")
        e.dr(L.setting(brand, "suppliers"), p.amount, None, "", f"supplier:{inv.supplier_id}")
        if p.cash_txn_id and p.cash_txn_id in cash_box_of:
            e.cr(L.cashbox(cash_box_of[p.cash_txn_id]), p.amount, cash_box_of[p.cash_txn_id])
        else:
            e.cr(chan_acc(p.channel_id, brand) or L.setting(brand, "bank_default"), p.amount)
        out.append(e)

    # Internal transfers: moves the cost of the items from the sending branch to the receiving branch.
    # Between the two companies it is a sale at cost, through due from / due to related parties.
    item_cat = {i.id: i.category for i in db.query(TransferItem.id, TransferItem.category).all()}
    tlines: dict[int, list[TransferOrderLine]] = {}
    orders_t = db.query(TransferOrder).filter(TransferOrder.date >= start, TransferOrder.status.in_(("dispatched", "received"))).all()
    for ln in db.query(TransferOrderLine).filter(TransferOrderLine.transfer_order_id.in_([o.id for o in orders_t] or [0])).all():
        tlines.setdefault(ln.transfer_order_id, []).append(ln)
    for o in orders_t:
        src, dst = o.source_branch_id, o.requesting_branch_id
        b_src, b_dst = L.branch_brand.get(src), L.branch_brand.get(dst)
        if not b_src or not b_dst or src == dst:
            continue
        value: dict[str, float] = {}
        for ln in tlines.get(o.id, []):
            qty = ln.received_qty if o.status == "received" and ln.received_qty is not None else ln.dispatched_qty
            key = "transfers_packaging" if item_cat.get(ln.item_id) == "packaging" else "transfers_food"
            value[key] = value.get(key, 0.0) + (qty or 0) * (ln.unit_price or 0)
        names = f"{L.branch_name.get(src, ('',))[0]} -> {L.branch_name.get(dst, ('',))[0]}"
        if b_src == b_dst:
            e = Entry(f"transfer:{o.id}", b_src, o.date, f"Internal transfer #{o.id} {names}"[:200], "transfer")
            for key, v in value.items():
                e.dr(L.setting(b_src, key), v, dst)
                e.cr(L.setting(b_src, key), v, src)
            out.append(e)
            continue
        e = Entry(f"transfer:{o.id}", b_src, o.date, f"Internal transfer #{o.id} {names}"[:200], "transfer")
        d = Entry(f"transfer_in:{o.id}", b_dst, o.date, f"Internal transfer #{o.id} {names}"[:200], "transfer")
        for key, v in value.items():
            e.dr(L.setting(b_src, "related_receivable"), v, src, "", f"company:{b_dst}")
            e.cr(L.setting(b_src, key), v, src)
            d.dr(L.setting(b_dst, key), v, dst)
            d.cr(L.setting(b_dst, "related_payable"), v, dst, "", f"company:{b_src}")
        out += [e, d]

    return out


def _next_number(db: Session, brand_id: int) -> int:
    return (db.query(func.max(AccJournal.number)).filter(AccJournal.brand_id == brand_id).scalar() or 0) + 1


def post_journal(db: Session, brand_id: int, d: date, description: str, lines, source: str = "manual",
                 source_key: Optional[str] = None, source_hash: Optional[str] = None, user_id: Optional[int] = None,
                 notes: Optional[str] = None) -> AccJournal:
    j = AccJournal(brand_id=brand_id, number=_next_number(db, brand_id), date=d, description=description, source=source,
                   source_key=source_key, source_hash=source_hash, is_active=True, created_by=user_id, notes=notes)
    db.add(j)
    db.flush()
    for account_id, branch_id, debit, credit, memo, *rest in lines:
        db.add(AccJournalLine(journal_id=j.id, account_id=account_id, branch_id=branch_id, debit=_r(debit), credit=_r(credit),
                              memo=memo or None, party=(rest[0] if rest else None) or None))
    return j


def reverse_journal(db: Session, j: AccJournal, reason: str, user_id: Optional[int] = None, d: Optional[date] = None) -> AccJournal:
    lines = db.query(AccJournalLine).filter(AccJournalLine.journal_id == j.id).all()
    rev = post_journal(db, j.brand_id, d or j.date, f"Reversal of #{j.number}: {j.description}"[:200],
                       [(l.account_id, l.branch_id, l.credit, l.debit, l.memo, l.party) for l in lines], source=j.source, user_id=user_id,
                       notes=reason)
    rev.is_active = False
    rev.reversal_of = j.id
    j.is_active = False
    j.reversed_by = rev.id
    return rev


def opening_entries(db: Session, L: Ledger, start: date) -> list[Entry]:
    """Balances carried into the ledger on the day before the start date, as Mudawwarah shows them."""
    from app.routes.cash import _box_summary
    from app.routes.channels import channel_balance

    out = []
    d = start - timedelta(days=1)
    by_brand: dict[int, Entry] = {}

    def entry(brand: int) -> Entry:
        if brand not in by_brand:
            by_brand[brand] = Entry(f"opening:{brand}", brand, d, f"Opening balances at {d:%d/%m/%Y}", "opening")
        return by_brand[brand]

    for b in db.query(Branch).all():
        if not b.brand_id:
            continue
        bal = _box_summary(db, b.id, start)["opening_balance"]
        entry(b.brand_id).dr(L.cashbox(b.id), bal, b.id, "Cash box")
    for ch in db.query(PaymentChannel).all():
        if ch.opening_date and ch.opening_date >= start:
            continue
        brand = ch.brand_id or 1
        entry(brand).dr(L.channel(ch, brand), channel_balance(db, ch, d), None, "Payment channel")
    # Provider receivables: non-cash sales since proceeds tracking began, less proceeds received.
    cols = {"knet": Sale.physical_knet, "link": Sale.physical_link, "talabat": Sale.physical_talabat, "keeta": Sale.physical_keeta,
            "jahez": Sale.physical_jahez, "snoonu": Sale.physical_snoonu}
    for brand in {bb for bb in L.branch_brand.values() if bb}:
        branch_ids = [k for k, v in L.branch_brand.items() if v == brand]
        for m in PROCEEDS_METHODS:
            due = db.query(func.coalesce(func.sum(cols[m]), 0)).filter(Sale.branch_id.in_(branch_ids), Sale.date >= CHANNEL_START,
                                                                       Sale.date < start).scalar()
            got = db.query(func.coalesce(func.sum(ProceedsReceipt.amount + func.coalesce(ProceedsReceipt.fees, 0)), 0)).filter(
                ProceedsReceipt.brand_id == brand, ProceedsReceipt.method == m, ProceedsReceipt.date < start).scalar()
            entry(brand).dr(L.code(brand, RECEIVABLE_CODES[m]), _r(due) - _r(got), None, f"{m.upper()} receivable", f"customer:{m}")
        # Staff advances outstanding: approved advances before start less salary deductions booked before start.
        emp_ids = [e.id for e in db.query(Employee.id).filter(Employee.branch_id.in_(branch_ids)).all()]
        adv: dict[int, float] = {}
        for ln in db.query(AdvanceLoan).filter(AdvanceLoan.employee_id.in_(emp_ids or [0]), AdvanceLoan.approval_status == "approved",
                                               AdvanceLoan.date < start).all():
            adv[ln.employee_id] = adv.get(ln.employee_id, 0.0) + (ln.amount or 0)
        for sp in db.query(SalaryPayment).filter(SalaryPayment.employee_id.in_(emp_ids or [0]), SalaryPayment.status == "paid").all():
            try:
                if date(int(sp.month[:4]), int(sp.month[5:7]), 1) < start.replace(day=1) and sp.loan_deduction:
                    adv[sp.employee_id] = adv.get(sp.employee_id, 0.0) - sp.loan_deduction
            except (TypeError, ValueError):
                continue
        for emp_id in sorted(adv):
            entry(brand).dr(L.setting(brand, "staff_advances"), adv[emp_id], None, "Staff advances", f"employee:{emp_id}")
        # Suppliers still unpaid at the start date: Central Purchases and branch credit purchases.
        owed: dict[int, float] = {}
        for inv in db.query(ProcInvoice).filter(ProcInvoice.brand_id == brand, ProcInvoice.date < start).all():
            paid = db.query(func.coalesce(func.sum(ProcPayment.amount), 0)).filter(ProcPayment.invoice_id == inv.id,
                                                                                ProcPayment.date < start).scalar()
            owed[inv.supplier_id] = owed.get(inv.supplier_id, 0.0) + _r(inv.total_amount) - _r(paid)
        for inv in db.query(Invoice).join(PurchaseOrder, PurchaseOrder.id == Invoice.purchase_order_id).filter(
                PurchaseOrder.date < start, Invoice.branch_id.in_(branch_ids)).all():
            paid_before = inv.status == "paid" and inv.paid_date is not None and inv.paid_date < start
            owed[inv.supplier_id] = owed.get(inv.supplier_id, 0.0) + (_r(inv.total_amount) - _r(inv.paid_amount) if paid_before
                                                                      else _r(inv.total_amount))
        for sup_id in sorted(owed):
            entry(brand).cr(L.setting(brand, "suppliers"), owed[sup_id], None, "Suppliers", f"supplier:{sup_id}")
    for brand, e in by_brand.items():
        diff = sum(l[2] - l[3] for l in e.lines)
        e.cr(L.setting(brand, "opening_equity"), diff, None, "Opening balance difference")
        if e.lines:
            out.append(e)
    return out


def sync_ledger(db: Session, user_id: Optional[int] = None) -> dict:
    s = get_settings(db)
    result = {"posted": 0, "reposted": 0, "reversed": 0, "unchanged": 0, "skipped": []}
    if not s.start_date:
        result["skipped"].append("No start date set")
        return result
    ensure_chart(db)
    L = Ledger(db)
    expected = {e.key: e for e in build_entries(db, L, s.start_date) + opening_entries(db, L, s.start_date)}
    active = {j.source_key: j for j in db.query(AccJournal).filter(AccJournal.source_key.isnot(None), AccJournal.is_active.is_(True)).all()}
    for key, e in expected.items():
        if not e.lines:
            continue
        if not e.balanced():
            result["skipped"].append(key)
            continue
        h = e.digest()
        cur = active.get(key)
        if cur and cur.source_hash == h:
            result["unchanged"] += 1
            continue
        if cur:
            reverse_journal(db, cur, "Source record changed", user_id)
            result["reposted"] += 1
        else:
            result["posted"] += 1
        post_journal(db, e.brand_id, e.date, e.description, e.lines, e.source, key, h, user_id)
    for key, j in active.items():
        if key not in expected or not expected[key].lines:
            reverse_journal(db, j, "Source record deleted", user_id)
            result["reversed"] += 1
    s.last_sync_at = datetime.now(timezone.utc).replace(tzinfo=None)
    s.last_sync_result = json.dumps(result)
    db.commit()
    return result

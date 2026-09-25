from sqlalchemy import Column, Integer, String, Float, Date, ForeignKey, DateTime, Text, Boolean
from datetime import datetime, timezone
from app.database import Base


class ProcOrder(Base):
    """Purchase Office purchase order: fully separate from branch purchase_orders.
    Never costs a branch; delivery_location is reference only."""
    __tablename__ = "proc_orders"

    id = Column(Integer, primary_key=True, index=True)
    po_no = Column(String, unique=True, index=True)
    brand_id = Column(Integer, ForeignKey("brands.id"), nullable=False)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=False)
    category_id = Column(Integer, ForeignKey("purchase_categories.id"), nullable=True)
    date = Column(Date, nullable=False)
    expected_date = Column(Date, nullable=True)
    payment_type = Column(String, default="cash")  # cash, credit
    delivery_location = Column(String, nullable=True)
    total = Column(Float, default=0)
    notes = Column(Text, nullable=True)
    # draft, pending, approved, returned, rejected, ordered, received, invoiced, paid, closed, cancelled
    status = Column(String, default="draft")
    attachment_path = Column(String, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    submitted_at = Column(DateTime, nullable=True)
    approved_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    approved_at = Column(DateTime, nullable=True)
    approval_comment = Column(Text, nullable=True)
    ordered_at = Column(DateTime, nullable=True)
    received_date = Column(Date, nullable=True)
    received_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    receiving_notes = Column(Text, nullable=True)
    receiving_attachment = Column(String, nullable=True)
    closed_at = Column(DateTime, nullable=True)


class ProcOrderItem(Base):
    __tablename__ = "proc_order_items"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("proc_orders.id"), nullable=False, index=True)
    supplier_item_id = Column(Integer, ForeignKey("supplier_items.id"), nullable=True)
    item_name = Column(String, nullable=False)
    item_name_ar = Column(String, nullable=True)
    packaging = Column(String, nullable=True)
    unit = Column(String, default="pcs")
    quantity = Column(Float, nullable=False, default=0)
    unit_price = Column(Float, nullable=False, default=0)
    total = Column(Float, nullable=False, default=0)
    received_qty = Column(Float, nullable=True)
    received_total = Column(Float, nullable=True)


class ProcInvoice(Base):
    """Supplier invoice for a Purchase Office order (cash or credit)."""
    __tablename__ = "proc_invoices"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("proc_orders.id"), nullable=False, index=True)
    brand_id = Column(Integer, ForeignKey("brands.id"), nullable=False)
    supplier_id = Column(Integer, ForeignKey("suppliers.id"), nullable=False)
    invoice_number = Column(String, nullable=True)
    date = Column(Date, nullable=False)
    due_date = Column(Date, nullable=True)
    total_amount = Column(Float, nullable=False, default=0)
    paid_amount = Column(Float, default=0)
    status = Column(String, default="pending")  # pending, partial, paid
    notes = Column(Text, nullable=True)
    attachment_path = Column(String, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class ProcPayment(Base):
    """Payment against a Purchase Office invoice. Only purchase_petty_cash posts a Cash Out
    on the Purchase Office cash box; other methods are recorded only (gateway hooks here later)."""
    __tablename__ = "proc_payments"

    id = Column(Integer, primary_key=True, index=True)
    invoice_id = Column(Integer, ForeignKey("proc_invoices.id"), nullable=False, index=True)
    date = Column(Date, nullable=False)
    amount = Column(Float, nullable=False)
    method = Column(String, default="purchase_petty_cash")  # purchase_petty_cash, bank_transfer, knet, cheque
    channel_id = Column(Integer, ForeignKey("payment_channels.id"), nullable=True)
    reference = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    cash_txn_id = Column(Integer, ForeignKey("cash_transactions.id"), nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class ProcOrderLog(Base):
    __tablename__ = "proc_order_logs"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("proc_orders.id"), nullable=False, index=True)
    status = Column(String, nullable=False)
    comment = Column(Text, nullable=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

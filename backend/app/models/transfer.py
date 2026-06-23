from sqlalchemy import Column, Integer, String, Float, Date, ForeignKey, DateTime, Text, Boolean
from datetime import datetime, timezone
from app.database import Base


class TransferItem(Base):
    __tablename__ = "transfer_items"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    name_ar = Column(String, nullable=True)
    unit = Column(String, default="pcs")
    is_active = Column(Boolean, default=True)


class TransferOrder(Base):
    __tablename__ = "transfer_orders"

    id = Column(Integer, primary_key=True, index=True)
    requesting_branch_id = Column(Integer, ForeignKey("branches.id"), nullable=False)
    date = Column(Date, nullable=False)
    status = Column(String, default="requested")  # requested, dispatched, received
    notes = Column(Text, nullable=True)
    dispatched_at = Column(DateTime, nullable=True)
    received_at = Column(DateTime, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class TransferOrderLine(Base):
    __tablename__ = "transfer_order_lines"

    id = Column(Integer, primary_key=True, index=True)
    transfer_order_id = Column(Integer, ForeignKey("transfer_orders.id"), nullable=False)
    item_id = Column(Integer, ForeignKey("transfer_items.id"), nullable=False)
    item_name = Column(String, nullable=False)
    item_name_ar = Column(String, nullable=True)
    requested_qty = Column(Float, nullable=False)
    dispatched_qty = Column(Float, nullable=True)
    received_qty = Column(Float, nullable=True)
    unit = Column(String, default="pcs")

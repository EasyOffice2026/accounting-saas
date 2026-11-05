from sqlalchemy import Column, Integer, String, Float, Date, ForeignKey, DateTime, Text, Boolean
from datetime import datetime, timezone
from app.database import Base


class PaymentChannel(Base):
    """Non-cash payment source (bank account, credit card, KNET terminal...).
    Payments booked against a channel reduce its balance; branch cash boxes are untouched."""
    __tablename__ = "payment_channels"

    id = Column(Integer, primary_key=True, index=True)
    brand_id = Column(Integer, ForeignKey("brands.id"), nullable=True)
    name = Column(String, nullable=False)
    name_ar = Column(String, nullable=True)
    kind = Column(String, default="bank")  # bank, card, knet, other
    account_no = Column(String, nullable=True)
    opening_balance = Column(Float, default=0)
    opening_date = Column(Date, nullable=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class ChannelTransaction(Base):
    __tablename__ = "channel_transactions"

    id = Column(Integer, primary_key=True, index=True)
    channel_id = Column(Integer, ForeignKey("payment_channels.id"), nullable=False, index=True)
    date = Column(Date, nullable=False)
    txn_type = Column(String, nullable=False)  # deposit, withdrawal
    amount = Column(Float, nullable=False)
    reference = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

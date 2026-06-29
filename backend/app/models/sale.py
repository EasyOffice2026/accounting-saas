from sqlalchemy import Column, Integer, String, Float, Date, ForeignKey, DateTime, Text
from datetime import datetime, timezone
from app.database import Base


class Sale(Base):
    __tablename__ = "sales"

    id = Column(Integer, primary_key=True, index=True)
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=False)
    date = Column(Date, nullable=False)
    # Foodics (POS) data
    foodics_cash = Column(Float, default=0)
    foodics_knet = Column(Float, default=0)
    foodics_link = Column(Float, default=0)
    foodics_wamd = Column(Float, default=0)
    foodics_talabat = Column(Float, default=0)
    foodics_keeta = Column(Float, default=0)
    foodics_jahez = Column(Float, default=0)
    foodics_other = Column(Float, default=0)
    foodics_snoonu = Column(Float, default=0)
    # Physical data
    physical_cash = Column(Float, default=0)
    physical_knet = Column(Float, default=0)
    physical_link = Column(Float, default=0)
    physical_wamd = Column(Float, default=0)
    physical_talabat = Column(Float, default=0)
    physical_keeta = Column(Float, default=0)
    physical_jahez = Column(Float, default=0)
    physical_other = Column(Float, default=0)
    physical_snoonu = Column(Float, default=0)
    # Attachment
    attachment_path = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class SaleReturn(Base):
    __tablename__ = "sale_returns"

    id = Column(Integer, primary_key=True, index=True)
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=False)
    date = Column(Date, nullable=False)
    return_type = Column(String, nullable=False)  # return, cancellation
    quantity = Column(Integer, default=0)
    amount = Column(Float, default=0)
    reason = Column(Text, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

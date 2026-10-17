from sqlalchemy import Column, Integer, String, Float, Date, ForeignKey, DateTime, Text, UniqueConstraint
from datetime import datetime, timezone
from app.database import Base


class ProceedsReceipt(Base):
    """Money received from a non-cash sales method (KNET, Talabat...) into a payment channel.
    amount = net received into the channel; fees = commission / charges deducted by the provider."""
    __tablename__ = "proceeds_receipts"

    id = Column(Integer, primary_key=True, index=True)
    brand_id = Column(Integer, ForeignKey("brands.id"), nullable=False, index=True)
    method = Column(String, nullable=False, index=True)
    branch_id = Column(Integer, ForeignKey("branches.id"), nullable=True)
    date = Column(Date, nullable=False)
    period_from = Column(Date, nullable=True)
    period_to = Column(Date, nullable=True)
    channel_id = Column(Integer, ForeignKey("payment_channels.id"), nullable=False, index=True)
    amount = Column(Float, default=0)
    fees = Column(Float, default=0)
    reference = Column(String, nullable=True)
    notes = Column(Text, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class ProceedsChannelMap(Base):
    """Default payment channel each sales method is paid into, per brand."""
    __tablename__ = "proceeds_channel_map"
    __table_args__ = (UniqueConstraint("brand_id", "method", name="uq_proceeds_brand_method"),)

    id = Column(Integer, primary_key=True, index=True)
    brand_id = Column(Integer, ForeignKey("brands.id"), nullable=False)
    method = Column(String, nullable=False)
    channel_id = Column(Integer, ForeignKey("payment_channels.id"), nullable=False)


PROCEEDS_METHODS = ("knet", "link", "talabat", "keeta", "jahez", "snoonu")
METHOD_LABELS = {
    "knet": ("KNET", "كي نت"), "link": ("Link", "لينك"), "talabat": ("Talabat", "طلبات"),
    "keeta": ("Keeta", "كيتا"), "jahez": ("Jahez", "جاهز"), "snoonu": ("Snoonu", "سنونو"),
}

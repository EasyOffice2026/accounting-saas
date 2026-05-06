from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey
from datetime import datetime, timezone
from app.database import Base


class PaymentGatewaySettings(Base):
    __tablename__ = "payment_gateway_settings"

    id = Column(Integer, primary_key=True, index=True)
    provider = Column(String, default="tap")  # tap, stripe, etc.
    secret_key = Column(String, nullable=False)
    publishable_key = Column(String, nullable=True)
    is_sandbox = Column(String, default="true")  # "true" or "false"
    currency = Column(String, default="KWD")


class PaymentTransaction(Base):
    __tablename__ = "payment_transactions"

    id = Column(Integer, primary_key=True, index=True)
    invoice_id = Column(Integer, ForeignKey("invoices.id"), nullable=False)
    charge_id = Column(String, nullable=True)
    amount = Column(Float, nullable=False)
    currency = Column(String, default="KWD")
    status = Column(String, default="initiated")  # initiated, captured, failed
    provider = Column(String, default="tap")
    redirect_url = Column(String, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))

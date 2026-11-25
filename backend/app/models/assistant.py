from sqlalchemy import Column, Integer, String, ForeignKey, DateTime, Text
from datetime import datetime, timezone
from app.database import Base


class AssistantLog(Base):
    """Every question asked to the AI assistant, its answer and the reports it read."""
    __tablename__ = "assistant_logs"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    channel = Column(String, nullable=False, default="app")  # app, whatsapp
    question = Column(Text, nullable=False)
    answer = Column(Text, nullable=True)
    reports = Column(Text, nullable=True)  # JSON list of {report, filters}
    error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

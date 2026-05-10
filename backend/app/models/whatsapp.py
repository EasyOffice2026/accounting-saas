from sqlalchemy import Column, Integer, String
from app.database import Base


class WhatsAppSettings(Base):
    __tablename__ = "whatsapp_settings"

    id = Column(Integer, primary_key=True, index=True)
    provider = Column(String, default="greenapi")  # greenapi
    instance_id = Column(String, nullable=True)
    api_token = Column(String, nullable=True)
    default_phone = Column(String, nullable=True)  # default recipient phone

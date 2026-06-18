from sqlalchemy import Boolean, Column, String
from sqlalchemy.dialects.sqlite import TEXT

from api.database import Base


class User(Base):
    __tablename__ = "users"

    id                 = Column(TEXT, primary_key=True, index=True)
    email              = Column(String, unique=True, index=True, nullable=False)
    google_id          = Column(String, unique=True, nullable=True)
    stripe_customer_id = Column(String, unique=True, nullable=True)
    is_premium         = Column(Boolean, default=False, nullable=False)

import os
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

load_dotenv()

_default_db = f"sqlite:///{Path(__file__).parent.parent / 'data' / 'app.db'}"
DATABASE_URL = os.getenv("DATABASE_URL", _default_db)

# SQLite needs check_same_thread=False; ignored by other drivers
_connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, connect_args=_connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass

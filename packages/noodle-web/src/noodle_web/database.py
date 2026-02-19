import logging
import os
from datetime import datetime
from sqlalchemy import create_engine, Column, Integer, String, DateTime, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from contextlib import contextmanager

logger = logging.getLogger(__name__)

# Get database URL from environment variable
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://noodleuser:noodlepass@localhost:5432/noodledb"
)

# Create SQLAlchemy engine
engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class ActivityLog(Base):
    """Model for storing user activity logs"""
    __tablename__ = "activity_logs"

    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    ip_address = Column(String(45), nullable=True)  # IPv6 can be up to 45 chars
    user_agent = Column(String(500), nullable=True)
    activity_type = Column(String(100), nullable=False, index=True)
    endpoint = Column(String(200), nullable=False)
    method = Column(String(10), nullable=False)
    status_code = Column(Integer, nullable=True)
    response_time_ms = Column(Integer, nullable=True)

    def __repr__(self):
        return f"<ActivityLog {self.id}: {self.method} {self.endpoint} at {self.timestamp}>"


def init_db():
    """
    Initialize the database by running Alembic migrations.
    Note: Tables should be created via Alembic migrations, not directly.
    This function is kept for backward compatibility but does nothing.
    Use 'alembic upgrade head' to apply migrations.
    """
    pass  # Migrations are handled by Alembic


@contextmanager
def get_db():
    """Context manager for database sessions"""
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def test_connection():
    """Test database connection"""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception as e:
        logger.debug("Database connection failed: %s", e)
        return False

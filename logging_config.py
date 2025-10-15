"""Logging configuration for the Noodle Planner application."""
import logging
import logging.handlers
import os
from pathlib import Path

# Create logs directory if it doesn't exist
LOGS_DIR = Path(__file__).parent / "logs"
LOGS_DIR.mkdir(exist_ok=True)

# Log file paths
APP_LOG_FILE = LOGS_DIR / "app.log"
AUTH_LOG_FILE = LOGS_DIR / "auth.log"

# Log format
LOG_FORMAT = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
DATE_FORMAT = "%Y-%m-%d %H:%M:%S"


def setup_logging():
    """Configure logging for the application."""
    # Root logger configuration
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)

    # Remove existing handlers to avoid duplicates
    for handler in root_logger.handlers[:]:
        root_logger.removeHandler(handler)

    # Console handler - INFO level
    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.INFO)
    console_formatter = logging.Formatter(LOG_FORMAT, DATE_FORMAT)
    console_handler.setFormatter(console_formatter)
    root_logger.addHandler(console_handler)

    # File handler with rotation - DEBUG level
    file_handler = logging.handlers.RotatingFileHandler(
        APP_LOG_FILE,
        maxBytes=10 * 1024 * 1024,  # 10 MB
        backupCount=5
    )
    file_handler.setLevel(logging.DEBUG)
    file_formatter = logging.Formatter(LOG_FORMAT, DATE_FORMAT)
    file_handler.setFormatter(file_formatter)
    root_logger.addHandler(file_handler)

    return root_logger


def get_auth_logger():
    """Get logger specifically for authentication events."""
    auth_logger = logging.getLogger("auth")
    auth_logger.setLevel(logging.INFO)

    # Remove existing handlers to avoid duplicates
    for handler in auth_logger.handlers[:]:
        auth_logger.removeHandler(handler)

    # Auth file handler with rotation
    auth_handler = logging.handlers.RotatingFileHandler(
        AUTH_LOG_FILE,
        maxBytes=10 * 1024 * 1024,  # 10 MB
        backupCount=5
    )
    auth_handler.setLevel(logging.INFO)
    auth_formatter = logging.Formatter(LOG_FORMAT, DATE_FORMAT)
    auth_handler.setFormatter(auth_formatter)
    auth_logger.addHandler(auth_handler)

    # Also log to console
    console_handler = logging.StreamHandler()
    console_handler.setLevel(logging.INFO)
    console_formatter = logging.Formatter(LOG_FORMAT, DATE_FORMAT)
    console_handler.setFormatter(console_formatter)
    auth_logger.addHandler(console_handler)

    return auth_logger

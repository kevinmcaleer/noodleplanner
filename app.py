from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from routes import router
from db import create_tables, add_test_user, DATABASE_URL
from contextlib import asynccontextmanager
import logging
from logging_config import setup_logging

# Setup logging
setup_logging()
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app):
	# Diagnostics: log database path to help verify persistence (BUG-0002 follow-up)
	logger.info(f"[startup] Using database file: {DATABASE_URL}")
	create_tables()
	add_test_user()
	yield


app = FastAPI(lifespan=lifespan)
app.include_router(router)
app.mount("/static", StaticFiles(directory="static"), name="static")

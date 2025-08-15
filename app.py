

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from routes import router
from db import create_tables, add_test_user
from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app):
	create_tables()
	add_test_user()
	yield


app = FastAPI(lifespan=lifespan)
app.include_router(router)
app.mount("/static", StaticFiles(directory="static"), name="static")

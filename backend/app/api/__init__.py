from fastapi import APIRouter
from app.api.endpoints import logs

api_router = APIRouter()
api_router.include_router(logs.router, prefix="/logs", tags=["logs"])

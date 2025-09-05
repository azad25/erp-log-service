from fastapi import APIRouter
from app.api.endpoints import logs

# Create separate routers for HTTP and WebSocket
api_router = APIRouter()
ws_router = APIRouter()

# Include REST API routes with /logs prefix
api_router.include_router(logs.router, prefix="/logs", tags=["logs"])

# Function to include both routers in the main app
def include_routes(app):
    # Include HTTP API routes with version prefix
    app.include_router(api_router, prefix=app.state.settings.API_V1_STR)
    
    # Manually register WebSocket endpoint at the root
    @app.websocket("/ws/logs/{container_id}")
    async def websocket_endpoint(websocket: WebSocket, container_id: str):
        return await logs.websocket_endpoint(websocket, container_id)

import logging
import uvicorn
import json
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from app.core.config import settings
from app.api import api_router
from app.services.log_streamer import get_log_streamer
import signal
import asyncio
import sys

# Configure logging
logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL.upper()),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# Handle graceful shutdown
async def shutdown_event():
    """Handle application shutdown"""
    logger.info("Shutting down...")
    streamer = get_log_streamer()
    if streamer:
        await streamer.stop_all()
    logger.info("Log streamer stopped")

# Handle startup event
async def startup_event():
    """Handle application startup"""
    logger.info("Starting up...")
    # Initialize any required services here

# Create FastAPI app
app = FastAPI(
    title=settings.PROJECT_NAME,
    description="Real-time Docker Log Viewer API",
    version=settings.VERSION,
    on_startup=[startup_event],
    on_shutdown=[shutdown_event]
)

# Configure CORS middleware
# Note: CORS doesn't actually apply to WebSocket connections, but we need it for HTTP
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, replace with specific origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"]
)

# Middleware to handle WebSocket upgrade requests
# This middleware needs to be careful not to interfere with WebSocket connections
@app.middleware("http")
async def websocket_upgrade_middleware(request, call_next):
    # Skip middleware for WebSocket connections
    if "upgrade" in request.headers.get("connection", "").lower() and \
       request.headers.get("upgrade", "").lower() == "websocket":
        return await call_next(request)
        
    # Handle WebSocket upgrade requests
    if "upgrade" in request.headers.get("connection", "").lower() and \
       request.headers.get("upgrade", "").lower() == "websocket":
        # Get the subprotocols if any
        subprotocols = []
        if "sec-websocket-protocol" in request.headers:
            subprotocols = [p.strip() for p in request.headers["sec-websocket-protocol"].split(",")]
        
        # Create a new response for the WebSocket handshake
        response = await call_next(request)
        
        # Add required WebSocket headers
        response.headers["Upgrade"] = "websocket"
        response.headers["Connection"] = "Upgrade"
        response.headers["Sec-WebSocket-Accept"] = request.headers.get("sec-websocket-key", "")
        
        # Add CORS headers for WebSocket connections
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "*"
        
        # If client sent subprotocols, accept the first one
        if subprotocols:
            response.headers["Sec-WebSocket-Protocol"] = subprotocols[0]
            
        return response
    
    # For regular HTTP requests, just call the next middleware
    response = await call_next(request)
    
    # Add CORS headers for regular HTTP requests to WebSocket endpoints
    if request.url.path.startswith(f"{settings.API_V1_STR}/ws/"):
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "*"
    
    return response

# Store settings in app state for access in routers
app.state.settings = settings

# Include API routes
from app.api import api_router
app.include_router(api_router, prefix=settings.API_V1_STR)

# Register WebSocket endpoint at the root level
from app.api.endpoints import logs

@app.websocket("/ws/logs/{container_id}")
async def websocket_endpoint(websocket: WebSocket, container_id: str):
    return await logs.websocket_endpoint(websocket, container_id)

# Debug endpoint to list all routes
@app.get("/debug/routes")
async def debug_routes():
    routes = []
    for route in app.routes:
        route_info = {
            "path": getattr(route, "path", ""),
            "name": getattr(route, "name", ""),
            "methods": getattr(route, "methods", []),
            "endpoint": route.endpoint.__name__ if hasattr(route, "endpoint") else "",
            "type": "websocket" if hasattr(route, "is_websocket") and route.is_websocket else "http"
        }
        routes.append(route_info)
    return {"routes": routes}

# Root endpoint
@app.get("/")
async def root():
    return {
        "name": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "docs": "/docs",
        "websocket": f"ws://{settings.HOST}:{settings.PORT}/ws/logs/{{container_id}}",
        "debug_routes": "/debug/routes"
    }

if __name__ == "__main__":
    import uvicorn
    import sys
    
    # Parse command line arguments for port override
    port = settings.PORT
    host = settings.HOST
    
    for i, arg in enumerate(sys.argv):
        if arg == "--port" and i + 1 < len(sys.argv):
            port = int(sys.argv[i + 1])
        elif arg == "--host" and i + 1 < len(sys.argv):
            host = sys.argv[i + 1]
    
    uvicorn.run(
        "main:app",
        host=host,
        port=port,
        reload=False,  # Disable reload in production
        log_level=settings.LOG_LEVEL.lower(),
        workers=1  # Required for WebSocket support
    )
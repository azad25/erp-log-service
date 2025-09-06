import logging
import uvicorn
import json
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from app.core.config import settings
from app.api import api_router
from app.services.log_streamer import get_log_streamer
import signal
import asyncio
import sys

# Configure logging with better formatting
logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL.upper()),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# Global health check task
health_check_task = None

# Handle graceful shutdown
async def shutdown_event():
    """Handle application shutdown with proper cleanup"""
    logger.info("Shutting down...")
    
    # Cancel health check task
    global health_check_task
    if health_check_task and not health_check_task.done():
        health_check_task.cancel()
        try:
            await health_check_task
        except asyncio.CancelledError:
            pass
    
    # Stop log streamer
    try:
        streamer = get_log_streamer()
        if streamer:
            await streamer.stop_all()
        logger.info("Log streamer stopped successfully")
    except Exception as e:
        logger.error(f"Error stopping log streamer: {str(e)}")

# Handle startup event with log service initialization
async def startup_event():
    """Handle application startup with log service initialization"""
    logger.info("Starting up...")
    
    try:
        # Initialize log streamer
        streamer = get_log_streamer()
        
        # Pre-warm Docker CLI connection
        docker_available = streamer._get_docker_client()
        if docker_available:
            logger.info("Log service initialized successfully with Docker CLI access")
        else:
            logger.warning("Log service initialized but Docker CLI access failed")
        
        # Start periodic health check
        global health_check_task
        health_check_task = asyncio.create_task(periodic_websocket_health_check())
        
        logger.info("Startup completed successfully")
        
    except Exception as e:
        logger.error(f"Error during startup: {str(e)}")
        raise

async def periodic_websocket_health_check():
    """Run periodic health checks on WebSocket connections"""
    try:
        streamer = get_log_streamer()
        while True:
            await asyncio.sleep(30)  # Check every 30 seconds
            try:
                await streamer.check_websocket_health()
            except Exception as e:
                logger.error(f"Error in WebSocket health check: {str(e)}")
    except asyncio.CancelledError:
        logger.info("WebSocket health check task cancelled")
    except Exception as e:
        logger.error(f"Critical error in health check: {str(e)}")

# Create FastAPI app with lifespan events
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await startup_event()
    yield
    # Shutdown
    await shutdown_event()

app = FastAPI(
    title=settings.PROJECT_NAME,
    description="Real-time Docker Log Viewer API",
    version=settings.VERSION,
    lifespan=lifespan
)

# Configure CORS middleware with optimized settings
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, replace with specific origins
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["*"]
)

# Simplified middleware for WebSocket support
@app.middleware("http")
async def add_cors_headers(request, call_next):
    """Add CORS headers for all requests including WebSocket upgrades"""
    response = await call_next(request)
    
    # Add CORS headers for WebSocket endpoints
    if request.url.path.startswith("/ws/") or request.url.path.startswith(f"{settings.API_V1_STR}/ws/"):
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "*"
        response.headers["Access-Control-Allow-Credentials"] = "true"
    
    return response

# Store settings in app state for access in routers
app.state.settings = settings

# Include API routes
app.include_router(api_router, prefix=settings.API_V1_STR)

# Import routers for WebSocket endpoints
from app.api.endpoints import logs
from app.api.endpoints import stats

# Register log WebSocket endpoint at the app level
@app.websocket("/ws/logs/{container_id}")
async def websocket_endpoint_root(websocket: WebSocket, container_id: str):
    """Root level WebSocket endpoint for logs"""
    await logs.websocket_endpoint(websocket, container_id)

# Register stats WebSocket endpoint at the app level
@app.websocket("/ws/stats/{container_id}")
async def websocket_stats_endpoint_root(websocket: WebSocket, container_id: str):
    """Root level WebSocket endpoint for container stats"""
    await logs.websocket_stats_endpoint(websocket, container_id)

# Also register under API prefix for consistency
@app.websocket("/api/v1/logs/ws/{container_id}")
async def websocket_endpoint_api(websocket: WebSocket, container_id: str):
    """API prefixed WebSocket endpoint"""
    await websocket_endpoint_root(websocket, container_id)

@app.websocket("/api/v1/ws/stats/{container_id}")
async def websocket_stats_endpoint_api(websocket: WebSocket, container_id: str):
    """API prefixed WebSocket stats endpoint"""
    await websocket_stats_endpoint_root(websocket, container_id)

# Health check endpoint
@app.get("/health")
async def health_check():
    """Health check endpoint"""
    try:
        streamer = get_log_streamer()
        docker_available = streamer._get_docker_client() is not None
        
        return {
            "status": "healthy",
            "service": settings.PROJECT_NAME,
            "version": settings.VERSION,
            "docker_available": docker_available,
            "active_containers": len(streamer.active_containers) if streamer else 0,
            "active_websockets": sum(len(ws_set) for ws_set in streamer.websockets.values()) if streamer else 0
        }
    except Exception as e:
        return {
            "status": "unhealthy",
            "error": str(e),
            "service": settings.PROJECT_NAME,
            "version": settings.VERSION
        }

# Debug endpoint to list all routes
@app.get("/debug/routes")
async def debug_routes():
    """Debug endpoint to show all registered routes"""
    routes = []
    for route in app.routes:
        route_info = {
            "path": getattr(route, "path", ""),
            "name": getattr(route, "name", ""),
            "methods": getattr(route, "methods", []),
            "endpoint": route.endpoint.__name__ if hasattr(route, "endpoint") else "",
            "type": "websocket" if hasattr(route, "endpoint") and "websocket" in route.endpoint.__name__.lower() else "http"
        }
        routes.append(route_info)
    return {"routes": routes, "total": len(routes)}

# Debug endpoint for WebSocket connections
@app.get("/debug/websockets")
async def debug_websockets():
    """Debug endpoint to show active WebSocket connections"""
    try:
        streamer = get_log_streamer()
        connections = {}
        
        for container_id, ws_set in streamer.websockets.items():
            connections[container_id] = {
                "count": len(ws_set),
                "container_active": container_id in streamer.active_containers,
                "has_logs": container_id in streamer.log_buffer,
                "log_count": len(streamer.log_buffer.get(container_id, []))
            }
        
        return {
            "connections": connections,
            "total_connections": sum(len(ws_set) for ws_set in streamer.websockets.values()),
            "active_containers": list(streamer.active_containers),
            "active_tasks": len(streamer.active_tasks)
        }
    except Exception as e:
        return {"error": str(e)}

# Root endpoint with comprehensive information
@app.get("/")
async def root():
    """Root endpoint with service information"""
    return {
        "name": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "status": "running",
        "endpoints": {
            "docs": "/docs",
            "health": "/health",
            "websocket_root": f"ws://{settings.HOST}:{settings.PORT}/ws/logs/{{container_id}}",
            "websocket_api": f"ws://{settings.HOST}:{settings.PORT}{settings.API_V1_STR}/ws/logs/{{container_id}}",
            "containers": f"{settings.API_V1_STR}/logs/containers",
            "debug_routes": "/debug/routes",
            "debug_websockets": "/debug/websockets"
        },
        "cors_enabled": True,
        "websocket_health_check": "enabled"
    }

# Signal handlers for graceful shutdown
def handle_sigterm(signum, frame):
    """Handle SIGTERM signal"""
    logger.info("Received SIGTERM signal")
    sys.exit(0)

def handle_sigint(signum, frame):
    """Handle SIGINT signal (Ctrl+C)"""
    logger.info("Received SIGINT signal")
    sys.exit(0)

# Register signal handlers
signal.signal(signal.SIGTERM, handle_sigterm)
signal.signal(signal.SIGINT, handle_sigint)

if __name__ == "__main__":
    import uvicorn
    import sys
    
    # Parse command line arguments for configuration override
    port = settings.PORT
    host = settings.HOST
    reload = False
    log_level = settings.LOG_LEVEL.lower()
    
    i = 1
    while i < len(sys.argv):
        arg = sys.argv[i]
        if arg == "--port" and i + 1 < len(sys.argv):
            port = int(sys.argv[i + 1])
            i += 2
        elif arg == "--host" and i + 1 < len(sys.argv):
            host = sys.argv[i + 1]
            i += 2
        elif arg == "--reload":
            reload = True
            i += 1
        elif arg == "--log-level" and i + 1 < len(sys.argv):
            log_level = sys.argv[i + 1].lower()
            i += 2
        else:
            i += 1
    
    logger.info(f"Starting {settings.PROJECT_NAME} v{settings.VERSION}")
    logger.info(f"Host: {host}, Port: {port}, Log Level: {log_level.upper()}")
    logger.info(f"Reload: {reload}, Workers: 1 (required for WebSocket)")
    
    # Run the application
    uvicorn.run(
        "main:app",
        host=host,
        port=port,
        reload=reload,
        log_level=log_level,
        workers=1,  # Required for WebSocket support
        access_log=True,
        use_colors=True,
        loop="asyncio"  # Explicitly use asyncio loop
    )
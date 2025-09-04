import logging
import uvicorn
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
    level=settings.LOG_LEVEL,
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

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, replace with specific origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routes
app.include_router(api_router, prefix=settings.API_V1_STR)

# Root endpoint
@app.get("/")
async def root():
    return {
        "name": settings.PROJECT_NAME,
        "version": settings.VERSION,
        "docs": "/docs",
        "websocket": f"ws://{settings.HOST}:{settings.PORT}{settings.API_V1_STR}/logs/ws/logs/{{container_id}}"
    }

# WebSocket endpoint for logs
@app.websocket(f"{settings.API_V1_STR}/logs/ws/logs/{{container_id}}")
async def websocket_logs(websocket: WebSocket, container_id: str):
    """WebSocket endpoint for streaming logs"""
    await websocket.accept()
    
    try:
        # Add WebSocket to active connections
        await log_streamer.add_websocket(websocket, container_id)
        
        # Keep connection alive
        while True:
            # Just keep receiving messages to detect disconnection
            await websocket.receive_text()
            
    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected for container: {container_id}")
    except Exception as e:
        logger.error(f"WebSocket error: {str(e)}")
    finally:
        # Clean up
        await get_log_streamer().remove_websocket(websocket, container_id)

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
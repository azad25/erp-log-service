from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, HTTPException
from typing import List, Dict, Any
import json
import logging
from app.core.config import settings
from app.services.log_processor import LogProcessor
from app.services.log_streamer import log_streamer

router = APIRouter()
logger = logging.getLogger(__name__)

@router.websocket("/ws/logs/{container_id}")
async def websocket_logs_endpoint(websocket: WebSocket, container_id: str):
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
        await log_streamer.remove_websocket(websocket, container_id)

@router.get("/containers", response_model=List[Dict[str, Any]])
async def list_containers():
    """List all running Docker containers"""
    try:
        return await log_streamer.processor.get_containers()
    except Exception as e:
        logger.error(f"Error listing containers: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/logs/{container_id}", response_model=List[Dict[str, Any]])
async def get_recent_logs(container_id: str, limit: int = 100):
    """Get recent logs for a container"""
    try:
        if container_id in log_streamer.log_buffer:
            return log_streamer.log_buffer[container_id][-limit:]
        return []
    except Exception as e:
        logger.error(f"Error getting recent logs: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

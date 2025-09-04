from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, HTTPException
from typing import List, Dict, Any
import json
import logging
from app.core.config import settings
from app.services.log_processor import LogProcessor
from app.services.log_streamer import get_log_streamer

router = APIRouter()
logger = logging.getLogger(__name__)

@router.websocket("/ws/logs/{container_id}")
async def websocket_logs_endpoint(websocket: WebSocket, container_id: str):
    """WebSocket endpoint for streaming logs"""
    await websocket.accept()
    
    try:
        # Get streamer instance
        streamer = get_log_streamer()
        
        # Add WebSocket to streamer
        await streamer.add_websocket(websocket, container_id)
        
        # Start streaming for this container if not 'all'
        if container_id != 'all':
            await streamer.start_streaming(container_id)
            
            # Send initial logs from buffer
            if container_id in streamer.log_buffer:
                for log in streamer.log_buffer[container_id]:
                    await websocket.send_text(json.dumps(log))
        
        # Keep connection alive
        while True:
            try:
                data = await websocket.receive_text()
                data = json.loads(data)
                
                # Handle heartbeat
                if data.get('type') == 'heartbeat':
                    await websocket.send_text(json.dumps({'type': 'heartbeat_ack'}))
                    continue
                    
            except WebSocketDisconnect:
                logger.info(f"Client disconnected from container {container_id}")
                break
            except json.JSONDecodeError:
                logger.warning(f"Invalid message format from client for container {container_id}")
                continue
                
    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected for container {container_id}")
    except Exception as e:
        logger.error(f"WebSocket error for container {container_id}: {e}")
    finally:
        # Clean up
        streamer = get_log_streamer()
        await streamer.remove_websocket(websocket, container_id)

@router.get("/containers", response_model=List[Dict[str, Any]])
async def list_containers():
    """List all running Docker containers"""
    try:
        return await get_log_streamer().processor.get_containers()
    except Exception as e:
        logger.error(f"Error listing containers: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/logs/{container_id}", response_model=List[Dict[str, Any]])
async def get_recent_logs(container_id: str, limit: int = 100):
    """Get recent logs for a container"""
    try:
        streamer = get_log_streamer()
        if container_id in streamer.log_buffer:
            return streamer.log_buffer[container_id][-limit:]
        return []
    except Exception as e:
        logger.error(f"Error getting recent logs: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/logs/{container_id}/stream")
async def stream_logs(container_id: str, lines: int = 100, follow: bool = False):
    """Stream logs for a container"""
    try:
        streamer = get_log_streamer()
        # For now, return recent logs from buffer or mock data
        if container_id in streamer.log_buffer:
            logs = streamer.log_buffer[container_id][-lines:]
        else:
            # Mock log data for testing
            logs = [
                {
                    "timestamp": "2025-09-04T03:45:00Z",
                    "level": "INFO",
                    "message": f"Mock log entry 1 for container {container_id}",
                    "source": "container"
                },
                {
                    "timestamp": "2025-09-04T03:45:01Z", 
                    "level": "INFO",
                    "message": f"Mock log entry 2 for container {container_id}",
                    "source": "container"
                },
                {
                    "timestamp": "2025-09-04T03:45:02Z",
                    "level": "WARN", 
                    "message": f"Mock warning log for container {container_id}",
                    "source": "container"
                }
            ]
        
        return {
            "container_id": container_id,
            "logs": logs,
            "total": len(logs)
        }
    except Exception as e:
        logger.error(f"Error streaming logs for {container_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/containers/{container_id}/start")
async def start_container(container_id: str):
    """Start a Docker container"""
    try:
        streamer = get_log_streamer()
        result = await streamer.processor.start_container(container_id)
        return {"status": "success", "message": result}
    except Exception as e:
        logger.error(f"Error starting container {container_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/containers/{container_id}/stop")
async def stop_container(container_id: str):
    """Stop a Docker container"""
    try:
        streamer = get_log_streamer()
        result = await streamer.processor.stop_container(container_id)
        return {"status": "success", "message": result}
    except Exception as e:
        logger.error(f"Error stopping container {container_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/containers/{container_id}/restart")
async def restart_container(container_id: str):
    """Restart a Docker container"""
    try:
        streamer = get_log_streamer()
        result = await streamer.processor.restart_container(container_id)
        return {"status": "success", "message": result}
    except Exception as e:
        logger.error(f"Error restarting container {container_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

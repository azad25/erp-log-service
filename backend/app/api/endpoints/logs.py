import asyncio
import json
import logging
import time
from datetime import datetime
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, HTTPException
from app.core.config import settings
from app.services.log_processor import LogProcessor
from app.services.log_streamer import get_log_streamer

# Create separate routers for HTTP and WebSocket
router = APIRouter()
logger = logging.getLogger(__name__)

# WebSocket endpoint will be registered directly in the main app

@router.websocket("/ws/logs/{container_id}")
async def websocket_endpoint(websocket: WebSocket, container_id: str):
    """WebSocket endpoint for streaming logs
    
    Args:
        websocket: The WebSocket connection
        container_id: ID of the container to stream logs from, or 'all' for all containers
    
    Handles the WebSocket lifecycle including:
    - Connection acceptance
    - Initial handshake
    - Error handling
    - Cleanup on disconnect
    """
    try:
        # Accept the WebSocket connection
        await websocket.accept()
        logger.info(f"WebSocket connection accepted for container {container_id}")
        
        try:
            # Send initial connection confirmation
            await websocket.send_json({
                "type": "connection_established",
                "message": "Connected to WebSocket server",
                "container_id": container_id,
                "timestamp": datetime.utcnow().isoformat()
            })
            
            # Handle the WebSocket connection
            await websocket_logs(websocket, container_id)
            
        except WebSocketDisconnect:
            logger.info(f"WebSocket client disconnected for container {container_id}")
            
        except Exception as e:
            error_msg = f"WebSocket error for container {container_id}: {str(e)}"
            logger.error(error_msg, exc_info=True)
            try:
                await websocket.close(code=1011, reason=error_msg[:123])  # WebSocket close reason has max length
            except Exception as close_error:
                logger.error(f"Error closing WebSocket: {str(close_error)}")
                
        finally:
            # Cleanup resources
            logger.info(f"WebSocket connection closed for container {container_id}")
            
    except Exception as e:
        # This handles connection acceptance failures
        error_msg = f"Failed to establish WebSocket connection: {str(e)}"
        logger.error(error_msg, exc_info=True)
        try:
            await websocket.close(code=1011, reason=error_msg[:123])
        except Exception as close_error:
            logger.error(f"Error during WebSocket cleanup: {str(close_error)}")
    finally:
        logger.info(f"WebSocket connection closed for container {container_id}")

async def websocket_logs(websocket: WebSocket, container_id: str):
    """Handle WebSocket connection for streaming logs
    
    Args:
        websocket: The WebSocket connection
        container_id: ID of the container to stream logs from, or 'all' for all containers
    """
    log_streamer = None
    last_ping_time = time.time()
    
    try:
        # Get the log streamer instance
        log_streamer = get_log_streamer()
        
        # Add WebSocket to active connections
        await log_streamer.add_websocket(websocket, container_id)
        logger.info(f"Added WebSocket for container {container_id}")
        
        # Keep connection alive
        while True:
            try:
                # Set a timeout for receiving messages
                data = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
                last_ping_time = time.time()
                
                # Handle ping/pong
                if data == "ping":
                    await websocket.send_text("pong")
                    continue
                    
                # Process other messages
                try:
                    message = json.loads(data)
                    if message.get("type") == "ping":
                        await websocket.send_json({
                            "type": "pong",
                            "timestamp": datetime.utcnow().isoformat()
                        })
                    elif message.get("type") == "update_filters":
                        # Handle filter updates if needed
                        logger.info(f"Received filter update: {message}")
                        
                except json.JSONDecodeError:
                    logger.warning(f"Received invalid JSON: {data}")
                    await websocket.send_json({
                        "type": "error",
                        "message": "Invalid JSON format"
                    })
                    
            except asyncio.TimeoutError:
                # Check if we need to send a ping
                time_since_last_ping = time.time() - last_ping_time
                if time_since_last_ping >= 30:  # 30 seconds since last message
                    try:
                        await websocket.send_text("ping")
                        # Wait for pong with a short timeout
                        try:
                            pong = await asyncio.wait_for(websocket.receive_text(), timeout=5.0)
                            if pong != "pong":
                                logger.warning(f"Expected 'pong', got '{pong}'")
                                raise WebSocketDisconnect()
                            last_ping_time = time.time()
                        except asyncio.TimeoutError:
                            logger.warning("Ping timeout, closing connection")
                            await websocket.close(code=1000, reason="Ping timeout")
                            raise WebSocketDisconnect()
                    except Exception as e:
                        logger.error(f"Error in ping/pong: {str(e)}")
                        raise WebSocketDisconnect()
                    
            except WebSocketDisconnect:
                logger.info(f"WebSocket disconnected for container {container_id}")
                break
                
            except Exception as e:
                logger.error(f"Error in WebSocket handler: {str(e)}", exc_info=True)
                try:
                    await websocket.send_json({
                        "type": "error",
                        "message": f"Error processing message: {str(e)}"
                    })
                    await websocket.close(code=1011, reason=str(e))
                except Exception as close_error:
                    logger.error(f"Error sending error message: {str(close_error)}")
                break
                
    except Exception as e:
        logger.error(f"WebSocket error for container {container_id}: {str(e)}", exc_info=True)
        try:
            await websocket.close(code=1011, reason=str(e))
        except Exception as close_error:
            logger.error(f"Error closing WebSocket: {str(close_error)}")
    finally:
        # Clean up
            try:
                await log_streamer.remove_websocket(websocket, container_id)
                logger.info(f"Removed WebSocket for container {container_id}")
            except Exception as e:
                logger.error(f"Error during WebSocket cleanup: {str(e)}")

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

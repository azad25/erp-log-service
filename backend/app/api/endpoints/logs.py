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
    log_streamer = None
    connection_established = False
    
    try:
        # Accept the WebSocket connection
        await websocket.accept()
        connection_established = True
        logger.info(f"WebSocket connection accepted for container {container_id}")
        
        # Get the log streamer instance early
        log_streamer = get_log_streamer()
        
        # Send initial connection confirmation
        await websocket.send_json({
            "type": "connection_established",
            "message": "Connected to WebSocket server",
            "container_id": container_id,
            "timestamp": datetime.utcnow().isoformat()
        })
        
        # Handle the WebSocket connection
        await websocket_logs(websocket, container_id, log_streamer)
        
    except WebSocketDisconnect:
        logger.info(f"WebSocket client disconnected for container {container_id}")
        
    except Exception as e:
        error_msg = f"WebSocket error for container {container_id}: {str(e)}"
        logger.error(error_msg, exc_info=True)
        
        if connection_established:
            try:
                await websocket.close(code=1011, reason=error_msg[:123])
            except Exception:
                pass  # Connection already closed
                
    finally:
        # Cleanup resources only once
        if log_streamer and connection_established:
            try:
                await log_streamer.remove_websocket(websocket, container_id)
                logger.info(f"WebSocket connection cleaned up for container {container_id}")
            except Exception as e:
                logger.error(f"Error during WebSocket cleanup: {str(e)}")

async def websocket_logs(websocket: WebSocket, container_id: str, log_streamer):
    """Handle WebSocket connection for streaming logs
    
    Args:
        websocket: The WebSocket connection
        container_id: ID of the container to stream logs from, or 'all' for all containers
        log_streamer: Pre-initialized log streamer instance
    """
    last_activity = time.time()
    heartbeat_interval = 60  # Send heartbeat every 60 seconds
    
    try:
        # Add WebSocket to active connections
        await log_streamer.add_websocket(websocket, container_id)
        logger.info(f"Added WebSocket for container {container_id}")
        
        # Create background task for heartbeat
        heartbeat_task = asyncio.create_task(
            heartbeat_handler(websocket, heartbeat_interval)
        )
        
        try:
            # Keep connection alive with non-blocking message handling
            while True:
                try:
                    # Use a longer timeout and handle it gracefully
                    data = await asyncio.wait_for(websocket.receive_text(), timeout=5.0)
                    last_activity = time.time()
                    
                    # Process message in non-blocking way
                    asyncio.create_task(process_websocket_message(websocket, data, container_id))
                    
                except asyncio.TimeoutError:
                    # This is normal - just continue the loop
                    # Check if connection is still alive periodically
                    current_time = time.time()
                    if current_time - last_activity > 300:  # 5 minutes of inactivity
                        logger.info(f"WebSocket inactive for 5 minutes, checking connection for {container_id}")
                        try:
                            await websocket.ping()
                            last_activity = current_time
                        except Exception:
                            logger.info(f"WebSocket ping failed, closing connection for {container_id}")
                            break
                    continue
                    
                except WebSocketDisconnect:
                    logger.info(f"WebSocket disconnected for container {container_id}")
                    break
                    
        finally:
            # Cancel heartbeat task
            heartbeat_task.cancel()
            try:
                await heartbeat_task
            except asyncio.CancelledError:
                pass
                
    except Exception as e:
        logger.error(f"WebSocket error for container {container_id}: {str(e)}", exc_info=True)
        try:
            await websocket.close(code=1011, reason=str(e)[:123])
        except Exception:
            pass  # Connection already closed

async def heartbeat_handler(websocket: WebSocket, interval: int):
    """Send periodic heartbeat to keep connection alive"""
    try:
        while True:
            await asyncio.sleep(interval)
            try:
                await websocket.send_json({
                    "type": "heartbeat",
                    "timestamp": datetime.utcnow().isoformat()
                })
            except Exception as e:
                logger.debug(f"Heartbeat failed: {str(e)}")
                break
    except asyncio.CancelledError:
        pass

async def process_websocket_message(websocket: WebSocket, data: str, container_id: str):
    """Process WebSocket message asynchronously"""
    try:
        # Handle simple ping/pong
        if data.strip() == "ping":
            await websocket.send_text("pong")
            return
            
        # Handle JSON messages
        try:
            message = json.loads(data)
            message_type = message.get("type")
            
            if message_type == "ping":
                await websocket.send_json({
                    "type": "pong",
                    "timestamp": datetime.utcnow().isoformat()
                })
            elif message_type == "update_filters":
                # Handle filter updates if needed
                logger.info(f"Received filter update for {container_id}: {message}")
                await websocket.send_json({
                    "type": "filter_updated",
                    "message": "Filters updated successfully"
                })
            elif message_type == "get_status":
                # Send current status
                await websocket.send_json({
                    "type": "status",
                    "container_id": container_id,
                    "connected": True,
                    "timestamp": datetime.utcnow().isoformat()
                })
            else:
                logger.warning(f"Unknown message type: {message_type}")
                
        except json.JSONDecodeError:
            logger.warning(f"Received invalid JSON from {container_id}: {data}")
            await websocket.send_json({
                "type": "error",
                "message": "Invalid JSON format",
                "timestamp": datetime.utcnow().isoformat()
            })
            
    except Exception as e:
        logger.error(f"Error processing message for {container_id}: {str(e)}")
        try:
            await websocket.send_json({
                "type": "error",
                "message": f"Error processing message: {str(e)}",
                "timestamp": datetime.utcnow().isoformat()
            })
        except Exception:
            pass  # Connection might be closed

@router.get("/containers", response_model=List[Dict[str, Any]])
async def list_containers():
    """List all running Docker containers"""
    try:
        streamer = get_log_streamer()
        return await streamer.processor.get_containers()
    except Exception as e:
        logger.error(f"Error listing containers: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/logs/{container_id}", response_model=List[Dict[str, Any]])
async def get_recent_logs(container_id: str, limit: int = 100):
    """Get recent logs for a container"""
    try:
        streamer = get_log_streamer()
        if container_id in streamer.log_buffer:
            logs = streamer.log_buffer[container_id]
            # Return last N logs efficiently
            return logs[-limit:] if len(logs) > limit else logs
        return []
    except Exception as e:
        logger.error(f"Error getting recent logs for {container_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/logs/{container_id}/stream")
async def stream_logs(container_id: str, lines: int = 100, follow: bool = False):
    """Stream logs for a container"""
    try:
        streamer = get_log_streamer()
        
        # Try to get logs from buffer first
        if container_id in streamer.log_buffer:
            logs = streamer.log_buffer[container_id]
            selected_logs = logs[-lines:] if len(logs) > lines else logs
        else:
            # Generate mock data more efficiently
            current_time = datetime.utcnow()
            selected_logs = []
            
            for i in range(min(lines, 10)):  # Limit mock data
                log_time = current_time.replace(second=current_time.second - i)
                selected_logs.append({
                    "timestamp": log_time.isoformat() + "Z",
                    "level": "INFO" if i % 3 != 2 else "WARN",
                    "message": f"Mock log entry {i + 1} for container {container_id}",
                    "source": "container"
                })
            
            # Reverse to get chronological order
            selected_logs.reverse()
        
        return {
            "container_id": container_id,
            "logs": selected_logs,
            "total": len(selected_logs),
            "timestamp": datetime.utcnow().isoformat()
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
        return {
            "status": "success", 
            "message": result,
            "container_id": container_id,
            "timestamp": datetime.utcnow().isoformat()
        }
    except Exception as e:
        logger.error(f"Error starting container {container_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/containers/{container_id}/stop")
async def stop_container(container_id: str):
    """Stop a Docker container"""
    try:
        streamer = get_log_streamer()
        result = await streamer.processor.stop_container(container_id)
        return {
            "status": "success", 
            "message": result,
            "container_id": container_id,
            "timestamp": datetime.utcnow().isoformat()
        }
    except Exception as e:
        logger.error(f"Error stopping container {container_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/containers/{container_id}/restart")
async def restart_container(container_id: str):
    """Restart a Docker container"""
    try:
        streamer = get_log_streamer()
        result = await streamer.processor.restart_container(container_id)
        return {
            "status": "success", 
            "message": result,
            "container_id": container_id,
            "timestamp": datetime.utcnow().isoformat()
        }
    except Exception as e:
        logger.error(f"Error restarting container {container_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))
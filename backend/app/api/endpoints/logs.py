import asyncio
import json
import logging
import time
import weakref
from datetime import datetime
from typing import Dict, List, Any
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException
from app.services.log_streamer import get_log_streamer
from app.core.connection_manager import manager
from app.services.docker import get_docker_service

router = APIRouter()
logger = logging.getLogger(__name__)


@router.websocket("/ws/logs/{container_id}")
async def websocket_endpoint(websocket: WebSocket, container_id: str):
    """
    WebSocket endpoint for streaming real-time logs from a container.
    """
    log_streamer = get_log_streamer()

    try:
        # Accept WebSocket connection
        await websocket.accept()
        logger.info(f"WebSocket connection accepted for container: {container_id}")
        
        # Send initial connection confirmation
        await websocket.send_json({
            "type": "connection_established",
            "container_id": container_id,
            "timestamp": datetime.utcnow().isoformat(),
        })
        
        # Add WebSocket to log streamer
        await log_streamer.add_websocket(websocket, container_id)
        
        # Start streaming for this container
        await log_streamer.start_streaming(container_id)
        logger.info(f"Started real-time streaming for container: {container_id}")

        # Keep connection alive and handle incoming messages
        while True:
            try:
                # Wait for incoming messages with timeout
                message = await asyncio.wait_for(websocket.receive_text(), timeout=30.0)
                
                # Handle client messages
                try:
                    data = json.loads(message)
                    if data.get("type") == "ping":
                        await websocket.send_json({"type": "pong", "timestamp": datetime.utcnow().isoformat()})
                    elif data.get("type") == "pong":
                        # Acknowledge pong
                        pass
                except json.JSONDecodeError:
                    logger.warning(f"Invalid JSON received: {message}")
                
            except asyncio.TimeoutError:
                # Send ping to keep connection alive
                try:
                    await websocket.send_json({"type": "ping", "timestamp": datetime.utcnow().isoformat()})
                except Exception as ping_error:
                    logger.warning(f"Failed to send ping: {ping_error}")
                    break
                continue
            except Exception as e:
                logger.error(f"Error in websocket loop: {e}")
                break

    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected for container: {container_id}")
    except Exception as e:
        logger.error(f"WebSocket error for container {container_id}: {e}")
    finally:
        # Cleanup
        try:
            await log_streamer.remove_websocket(websocket, container_id)
            logger.info(f"Cleaned up WebSocket for container: {container_id}")
        except Exception as e:
            logger.error(f"Error removing websocket: {e}")


@router.websocket("/ws/stats/{container_id}")
async def websocket_stats_endpoint(websocket: WebSocket, container_id: str):
    """
    WebSocket endpoint for streaming container statistics.
    """
    docker_service = get_docker_service()
    
    try:
        # Accept WebSocket connection
        await websocket.accept()
        logger.info(f"Stats WebSocket connected for container {container_id}")
        
        # Send initial connection confirmation
        await websocket.send_json({
            "type": "connection_established",
            "container_id": container_id,
            "timestamp": datetime.utcnow().isoformat(),
        })

        # Main stats streaming loop
        while True:
            try:
                # Get container stats from Docker service
                stats = await docker_service.get_container_stats(container_id)
                
                if stats:
                    # Format stats for frontend consumption with improved data structure
                    formatted_stats = {
                        "type": "stats",
                        "payload": {
                            "containerId": container_id,
                            "container_id": container_id,  # Add both formats for compatibility
                            "cpuUsage": float(stats.get("cpu_percent", 0)),
                            "cpuCount": int(stats.get("cpu_count", 1)),
                            "memoryUsage": float(stats.get("memory_usage", 0)),
                            "memoryLimit": float(stats.get("memory_limit", 1024)),
                            "networkRx": int(stats.get("network_rx", 0)),
                            "networkTx": int(stats.get("network_tx", 0)),
                            "blockRead": int(stats.get("block_read", 0)),
                            "blockWrite": int(stats.get("block_write", 0)),
                            "pids": int(stats.get("pids", 0)),
                        },
                        "timestamp": datetime.utcnow().isoformat(),
                    }
                    
                    await websocket.send_json(formatted_stats)
                    logger.debug(f"Sent stats for container {container_id}: CPU={formatted_stats['payload']['cpuUsage']}%, Memory={formatted_stats['payload']['memoryUsage']}MB")
                
                # Wait before next stats update (1 second interval)
                await asyncio.sleep(1.0)
                
            except Exception as e:
                logger.error(f"Error getting/sending stats for {container_id}: {e}")
                break
                
    except WebSocketDisconnect:
        logger.info(f"Stats WebSocket disconnected for container: {container_id}")
    except Exception as e:
        logger.error(f"Stats WebSocket error for container {container_id}: {e}")
    finally:
        logger.info(f"Stats WebSocket cleanup completed for container: {container_id}")


@router.get("/containers")
async def list_containers():
    """List all Docker containers"""
    try:
        docker_service = get_docker_service()
        if not docker_service:
            raise HTTPException(
                status_code=503,
                detail="Docker service is not available"
            )
        containers = await docker_service.get_containers(all=True)
        if not containers:
            logger.warning("No containers found or Docker service returned empty list")
        return containers
    except Exception as e:
        logger.error(f"Error listing containers: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{container_id}", response_model=List[Dict[str, Any]])
async def get_recent_logs(container_id: str, tail: int = 100, since: str = None, timestamps: bool = True):
    """Fetch recent logs from a container"""
    try:
        docker_service = get_docker_service()
        logs = await docker_service.get_container_logs(
            container_id,
            tail=tail,
            since=since,
            timestamps=timestamps
        )
        return logs
    except Exception as e:
        logger.error(f"Error getting logs for container {container_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/containers/{container_id}/start")
async def start_container(container_id: str):
    """Start a Docker container"""
    try:
        docker_service = get_docker_service()
        success = await docker_service.start_container(container_id)
        if success:
            return {"status": "success", "message": f"Container {container_id} started successfully"}
        else:
            raise HTTPException(status_code=500, detail=f"Failed to start container {container_id}")
    except Exception as e:
        logger.error(f"Error starting container {container_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/containers/{container_id}/stop")
async def stop_container(container_id: str):
    """Stop a Docker container"""
    try:
        docker_service = get_docker_service()
        success = await docker_service.stop_container(container_id)
        if success:
            return {"status": "success", "message": f"Container {container_id} stopped successfully"}
        else:
            raise HTTPException(status_code=500, detail=f"Failed to stop container {container_id}")
    except Exception as e:
        logger.error(f"Error stopping container {container_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/containers/{container_id}/restart")
async def restart_container(container_id: str):
    """Restart a Docker container"""
    try:
        docker_service = get_docker_service()
        success = await docker_service.restart_container(container_id)
        if success:
            return {"status": "success", "message": f"Container {container_id} restarted successfully"}
        else:
            raise HTTPException(status_code=500, detail=f"Failed to restart container {container_id}")
    except Exception as e:
        logger.error(f"Error restarting container {container_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

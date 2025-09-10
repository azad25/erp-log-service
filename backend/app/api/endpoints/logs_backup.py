import asyncio
import logging
import time
import weakref
from datetime import datetime
from typing import Dict, List, Any
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException
from app.services.log_streamer import get_log_streamer
from app.core.connection_manager import manager
from app.services.docker_service import get_docker_service

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
                except json.JSONDecodeError:
                    logger.warning(f"Invalid JSON received: {message}")
                
            except asyncio.TimeoutError:
                # Send ping to keep connection alive
                await websocket.send_json({"type": "ping", "timestamp": datetime.utcnow().isoformat()})
                continue
            except Exception as e:
                logger.error(f"Error in websocket loop: {e}")
                break
                            active_containers.add(new_cid)
                            await websocket.send_json({
                                "type": "subscription_confirmed",
                                "container_id": new_cid,
                                "timestamp": datetime.utcnow().isoformat(),
                            })
                            logger.info(f"Subscribed to container {new_cid}")
                        except Exception as e:
                            await websocket.send_json({
                                "type": "subscription_error",
                                "container_id": new_cid,
                                "error": str(e),
                                "timestamp": datetime.utcnow().isoformat(),
                            })
                    else:
                        await websocket.send_json({
                            "type": "subscription_confirmed",
                            "container_id": new_cid,
                            "message": "Already subscribed to this container",
                            "timestamp": datetime.utcnow().isoformat(),
                        })

                elif msg_type == "filter":
                    filters = data.get("filters", {})
                    logger.debug(f"Filters applied for {container_id}: {filters}")
                    # TODO: integrate with log_streamer filtering

                elif msg_type == "unsubscribe":
                    unsub_cid = data.get("container_id")
                    if unsub_cid and unsub_cid in active_containers:
                        try:
                            await manager.disconnect(websocket, unsub_cid)
                            await log_streamer.remove_websocket(websocket, unsub_cid)
                            active_containers.discard(unsub_cid)
                            await websocket.send_json({
                                "type": "unsubscription_confirmed",
                                "container_id": unsub_cid,
                                "timestamp": datetime.utcnow().isoformat(),
                            })
                            logger.info(f"Unsubscribed from container {unsub_cid}")
                        except Exception as e:
                            await websocket.send_json({
                                "type": "unsubscription_error",
                                "container_id": unsub_cid,
                                "error": str(e),
                                "timestamp": datetime.utcnow().isoformat(),
                            })
                    else:
                        await websocket.send_json({
                            "type": "unsubscription_error",
                            "container_id": unsub_cid,
                            "error": "Not subscribed to this container or container_id missing",
                            "timestamp": datetime.utcnow().isoformat(),
                        })

                else:
                    # Unknown message type
                    await websocket.send_json({
                        "type": "error",
                        "message": f"Unknown message type: {msg_type}",
                        "timestamp": datetime.utcnow().isoformat(),
                    })

            except asyncio.TimeoutError:
                # Normal idle timeout, loop continues
                continue
            except json.JSONDecodeError:
                # Malformed JSON
                try:
                    await websocket.send_json({
                        "type": "error",
                        "message": "Invalid JSON format",
                        "timestamp": datetime.utcnow().isoformat(),
                    })
                except:
                    pass  # Connection might be broken
                continue
            except WebSocketDisconnect:
                break
            except Exception as e:
                logger.error(f"Message loop error: {e}")
                break

    except WebSocketDisconnect:
        logger.info(f"Client disconnected: {active_containers}")
    finally:
        # Cleanup
        for cid in active_containers:
            try:
                await log_streamer.remove_websocket(websocket, cid)
            except Exception as e:
                logger.error(f"Cleanup error for {cid}: {e}")

        await manager.disconnect(websocket)
        try:
            await websocket.close()
        except Exception:
            pass


@router.websocket("/ws/stats/{container_id}")
async def websocket_stats_endpoint(websocket: WebSocket, container_id: str):
    """
    WebSocket endpoint for streaming container statistics.
    Provides real-time CPU, memory, network, and disk usage stats.
    """
    docker_service = get_docker_service()
    
    try:
        await manager.connect(websocket, f"stats_{container_id}")
        logger.info(f"Stats WebSocket connected for container {container_id}")
        
        # Send initial connection confirmation
        await websocket.send_json({
            "type": "connection_established",
            "container_id": container_id,
            "timestamp": datetime.utcnow().isoformat(),
        })

        # Keep connection alive and handle incoming messages
        try:
            while True:
                try:
                    # Wait for incoming messages with longer timeout
                    message = await asyncio.wait_for(websocket.receive_text(), timeout=60.0)
                    
                    # Handle client messages (filters, etc.)
                    try:
                        data = json.loads(message)
                        if data.get("type") == "filter":
                            # Handle filter updates
                            filters = data.get("filters", {})
                            logger.info(f"Updated filters for {container_id}: {filters}")
                        elif data.get("type") == "ping":
                            # Respond to client ping
                            await websocket.send_json({"type": "pong", "timestamp": datetime.utcnow().isoformat()})
                    except json.JSONDecodeError:
                        logger.warning(f"Invalid JSON received from websocket: {message}")
                    
                except asyncio.TimeoutError:
                    # Send ping to keep connection alive
                    await websocket.send_json({"type": "ping", "timestamp": datetime.utcnow().isoformat()})
                    continue
                except Exception as e:
                    logger.error(f"Error in websocket message handling: {e}")
                    break
        except Exception as e:
            logger.error(f"Error in websocket main loop: {e}")

        # Main stats streaming loop
        while True:
            try:
                # Get container stats from Docker service
                stats = await docker_service.get_container_stats(container_id)
                
                if stats:
                    # Format stats for frontend consumption
                    formatted_stats = {
                        "type": "stats",
                        "payload": {
                            "containerId": container_id,
                            "cpuUsage": float(stats.get("cpu_percent", 0)),
                            "cpuCount": int(stats.get("cpu_count", 1)),
                            "memoryUsage": float(stats.get("memory_usage", 0)),  # Already in MB from Docker service
                            "memoryLimit": float(stats.get("memory_limit", 1024)),  # Already in MB from Docker service
                            "networkRx": int(stats.get("network_rx", 0)),
                            "networkTx": int(stats.get("network_tx", 0)),
                            "blockRead": int(stats.get("block_read", 0)),
                            "blockWrite": int(stats.get("block_write", 0)),
                            "pids": int(stats.get("pids", 0)),
                        },
                        "timestamp": datetime.utcnow().isoformat(),
                    }
                    
                    await websocket.send_json(formatted_stats)
                
                # Wait before next stats update (1 second interval)
                await asyncio.sleep(1.0)
                
            except Exception as e:
                logger.error(f"Error getting stats for container {container_id}: {e}")
                await websocket.send_json({
                    "type": "error",
                    "message": f"Failed to get container stats: {str(e)}",
                    "timestamp": datetime.utcnow().isoformat(),
                })
                await asyncio.sleep(5.0)  # Wait longer on error
                
    except WebSocketDisconnect:
        logger.info(f"Stats WebSocket disconnected for container {container_id}")
    except Exception as e:
        logger.error(f"Stats WebSocket error for container {container_id}: {e}")
    finally:
        await manager.disconnect(websocket)
        try:
            await websocket.close()
        except Exception:
            pass


@router.get("/ws/stats")
async def get_websocket_stats():
    """WebSocket connection stats from ConnectionManager"""
    stats = await manager.get_stats()
    return {
        "status": "ok",
        "timestamp": datetime.utcnow().isoformat(),
        "connections": stats,
    }


@router.get("/containers")
async def list_containers():
    """List running Docker containers"""
    try:
        docker_service = get_docker_service()
        if not docker_service.is_available:
            if not await docker_service.verify_connection():
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


@router.post("/containers/{container_id}/exec")
async def execute_command(container_id: str, command: str, workdir: str = None):
    """Execute a command in a container"""
    try:
        docker_service = get_docker_service()
        # Note: execute_command method doesn't exist in DockerService yet
        # For now, return a not implemented error
        raise HTTPException(status_code=501, detail="Execute command functionality not yet implemented")
    except Exception as e:
        logger.error(f"Error executing command in container {container_id}: {e}")
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
            raise HTTPException(status_code=500, detail="Failed to start container")
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
            raise HTTPException(status_code=500, detail="Failed to stop container")
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
            raise HTTPException(status_code=500, detail="Failed to restart container")
    except Exception as e:
        logger.error(f"Error restarting container {container_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/containers/{container_id}/stats")
async def get_container_stats(container_id: str):
    """Get container statistics"""
    try:
        docker_service = get_docker_service()
        stats = await docker_service.get_container_stats(container_id)
        return stats
    except Exception as e:
        logger.error(f"Error getting stats for container {container_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))

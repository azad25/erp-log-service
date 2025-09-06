import asyncio
import json
import logging
from datetime import datetime
from typing import List, Optional, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from ...core.dependencies import get_log_processor, get_log_streamer, get_docker_service
from ...services.log_processor import LogProcessor
from ...services.log_streamer import LogStreamer
from ...core.connection_manager import manager
from ...services.docker import DockerService

router = APIRouter()
logger = logging.getLogger(__name__)


@router.websocket("/ws/logs/{container_id}")
async def websocket_endpoint(websocket: WebSocket, container_id: str):
    """
    WebSocket endpoint for streaming real-time logs from a single container or all containers.
    By default, only streams new logs as they arrive.
    
    Features:
    - Real-time log streaming only (no historical data by default)
    - Multi-container subscription
    - Uses global ConnectionManager for health & keep-alive
    - Graceful cleanup on disconnect
    - Initial confirmation + filter/subscribe support
    """
    log_streamer = get_log_streamer()
    active_containers = set()

    try:
        # Expand "all" to every container
        target_containers = [container_id]
        if container_id == "all":
            containers = await log_streamer.processor.get_containers()
            target_containers = [c["id"] for c in containers]
            
        # Log the connection attempt
        logger.info(f"New WebSocket connection for containers: {target_containers}")

        # Subscribe websocket to containers
        for cid in target_containers:
            try:
                await manager.connect(websocket, cid)
                await log_streamer.add_websocket(websocket, cid)
                try:
                    # Start real-time streaming for this container (no historical data)
                    await log_streamer.start_streaming(cid)
                    active_containers.add(cid)
                    logger.info(f"Started real-time streaming for container: {cid}")
                except Exception as e:
                    logger.error(f"Failed to start streaming for container {cid}: {e}")
                    await websocket.send_json({
                        "type": "error",
                        "container_id": cid,
                        "message": f"Failed to start streaming: {str(e)}",
                        "timestamp": datetime.utcnow().isoformat()
                    })
            except Exception as e:
                logger.error(f"Failed to connect to container {cid}: {e}")

        if not active_containers:
            await websocket.close(code=1008, reason="No valid containers")
            return

        logger.info(f"WebSocket connected to {len(active_containers)} containers")

        # Initial handshake
        await websocket.send_json({
            "type": "connection_established",
            "containers": list(active_containers),
            "timestamp": datetime.utcnow().isoformat(),
        })

        # Main loop for handling WebSocket messages
        while True:
            try:
                # Wait for messages with a timeout to handle ping/pong
                data = await asyncio.wait_for(websocket.receive_json(), timeout=30.0)

                if not isinstance(data, dict):
                    await websocket.send_json({
                        "type": "error",
                        "message": "Invalid message format - expected JSON object",
                        "timestamp": datetime.utcnow().isoformat(),
                    })
                    continue

                msg_type = data.get("type")

                if msg_type == "ping":
                    await websocket.send_json({
                        "type": "pong",
                        "timestamp": datetime.utcnow().isoformat(),
                    })
                    manager.update_activity(websocket)

                elif msg_type == "pong":
                    manager.update_activity(websocket)

                elif msg_type == "subscribe":
                    new_cid = data.get("container_id")
                    if not new_cid:
                        await websocket.send_json({
                            "type": "subscription_error",
                            "error": "Missing container_id in subscribe message",
                            "timestamp": datetime.utcnow().isoformat(),
                        })
                        continue
                        
                    if new_cid not in active_containers:
                        try:
                            # Validate container exists
                            containers = await log_streamer.processor.get_containers()
                            container_exists = any(c["id"] == new_cid or c.get("name") == new_cid for c in containers)
                            
                            if not container_exists:
                                await websocket.send_json({
                                    "type": "subscription_error",
                                    "container_id": new_cid,
                                    "error": f"Container '{new_cid}' not found",
                                    "timestamp": datetime.utcnow().isoformat(),
                                })
                                continue
                            
                            await manager.connect(websocket, new_cid)
                            await log_streamer.add_websocket(websocket, new_cid)
                            # Start streaming for this container
                            await log_streamer.start_streaming(new_cid)
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
        
        # Main stats streaming loop
        while True:
            try:
                # Check for incoming messages (ping/pong)
                try:
                    data = await asyncio.wait_for(websocket.receive_json(), timeout=0.1)
                    if data.get("type") == "ping":
                        await websocket.send_json({
                            "type": "pong",
                            "timestamp": datetime.utcnow().isoformat(),
                        })
                        manager.update_activity(websocket)
                except asyncio.TimeoutError:
                    pass  # No message received, continue with stats
                except Exception as e:
                    logger.debug(f"Error handling message in stats: {e}")
                
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

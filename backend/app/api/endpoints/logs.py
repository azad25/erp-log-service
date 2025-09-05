import asyncio
import json
import logging
import time
from datetime import datetime
from typing import List, Dict, Any
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException

from app.core.config import settings
from app.services.log_streamer import get_log_streamer
from app.services.docker import get_docker_service
from app.core.connection_manager import manager  # ✅ use optimized manager

router = APIRouter()
logger = logging.getLogger(__name__)


@router.websocket("/ws/logs/{container_id}")
async def websocket_endpoint(websocket: WebSocket, container_id: str):
    """
    WebSocket endpoint for streaming logs from a single container or all containers.
    Features:
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

        # Subscribe websocket to containers
        for cid in target_containers:
            try:
                await manager.connect(websocket, cid)
                await log_streamer.add_websocket(websocket, cid)
                active_containers.add(cid)
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

        # Main loop
        while True:
            try:
                data = await asyncio.wait_for(websocket.receive_json(), timeout=30.0)

                if not isinstance(data, dict):
                    continue

                msg_type = data.get("type")

                if msg_type == "pong":
                    manager.update_activity(websocket)

                elif msg_type == "subscribe":
                    new_cid = data.get("container_id")
                    if new_cid and new_cid not in active_containers:
                        try:
                            await manager.connect(websocket, new_cid)
                            await log_streamer.add_websocket(websocket, new_cid)
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

                elif msg_type == "filter":
                    filters = data.get("filters", {})
                    logger.debug(f"Filters applied for {container_id}: {filters}")
                    # TODO: integrate with log_streamer filtering

            except asyncio.TimeoutError:
                # Normal idle timeout, loop continues
                continue
            except WebSocketDisconnect:
                break
            except json.JSONDecodeError:
                logger.warning("Invalid JSON from client")
                continue
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


@router.get("/ws/stats")
async def get_websocket_stats():
    """WebSocket connection stats from ConnectionManager"""
    stats = await manager.get_stats()
    return {
        "status": "ok",
        "timestamp": datetime.utcnow().isoformat(),
        "connections": stats,
    }


@router.get("/containers", response_model=List[Dict[str, Any]])
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

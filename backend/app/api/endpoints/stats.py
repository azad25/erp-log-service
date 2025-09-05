import asyncio
import json
import logging
from typing import Dict, Optional
from fastapi import WebSocket, WebSocketDisconnect, APIRouter
import docker
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

class StatsStreamer:
    """Stream container statistics via WebSocket with enhanced metrics calculation"""
    
    def __init__(self):
        self.client = None
        self.active_tasks: Dict[str, asyncio.Task] = {}
        self._docker_cli_available = None
        self._docker_cli_check_time = None
        
    def _get_docker_client(self):
        """Check Docker CLI availability (SDK client disabled due to URL scheme issues)"""
        if self._docker_cli_available is None:
            try:
                import subprocess
                result = subprocess.run(['docker', 'version'], 
                                     capture_output=True, text=True, timeout=5)
                self._docker_cli_available = result.returncode == 0
                if self._docker_cli_available:
                    logger.info("Docker CLI is available")
                else:
                    logger.warning("Docker CLI is not available")
            except Exception as e:
                logger.error(f"Failed to check Docker CLI: {e}")
                self._docker_cli_available = False
        return 'cli' if self._docker_cli_available else None
        
    def _calculate_metrics(self, stats: dict) -> dict:
        """Calculate container metrics from Docker stats"""
        try:
            # CPU Usage calculation
            cpu_delta = stats['cpu_stats']['cpu_usage']['total_usage'] - \
                       stats['precpu_stats']['cpu_usage']['total_usage']
            system_cpu_delta = stats['cpu_stats']['system_cpu_usage'] - \
                             stats['precpu_stats']['system_cpu_usage']
            online_cpus = stats['cpu_stats'].get('online_cpus', 
                len(stats['cpu_stats']['cpu_usage'].get('percpu_usage', [1])))
            
            if system_cpu_delta > 0 and cpu_delta > 0:
                # Calculate CPU usage percentage for all cores
                cpu_usage = (cpu_delta / system_cpu_delta) * online_cpus * 100.0
            else:
                cpu_usage = 0.0
            
            # Memory Usage (in bytes)
            memory_stats = stats.get('memory_stats', {})
            memory_usage = memory_stats.get('usage', 0)
            if 'stats' in memory_stats:
                # Cache and buffer memory should not be counted as used memory
                cache = memory_stats['stats'].get('cache', 0)
                memory_usage = memory_usage - cache
                
            memory_limit = memory_stats.get('limit', 0)
            
            if memory_limit == 0:
                memory_limit = 1  # Avoid division by zero
                
            # Convert to megabytes for better readability
            memory_usage = memory_usage / (1024 * 1024)  # Convert to MB
            memory_limit = memory_limit / (1024 * 1024)  # Convert to MB
            
            # Network stats (convert to MB)
            networks = stats.get('networks', {})
            rx_bytes = sum(net.get('rx_bytes', 0) for net in networks.values()) / (1024 * 1024)
            tx_bytes = sum(net.get('tx_bytes', 0) for net in networks.values()) / (1024 * 1024)
            
            # Block I/O stats (convert to MB)
            block_stats = stats.get('blkio_stats', {})
            block_read = 0
            block_write = 0
            
            # Calculate block I/O in MB
            for stat in block_stats.get('io_service_bytes_recursive', []):
                if stat['op'] == 'Read':
                    block_read += stat['value']
                elif stat['op'] == 'Write':
                    block_write += stat['value']
            
            block_read = block_read / (1024 * 1024)
            block_write = block_write / (1024 * 1024)
            
            # Format values for better precision and readability
            stats_payload = {
                "type": "stats",
                "payload": {
                    "cpuUsage": round(cpu_usage, 2),
                    "cpuCount": online_cpus,
                    "memoryUsage": round(memory_usage, 2),  # In MB
                    "memoryLimit": round(memory_limit, 2),  # In MB
                    "memoryPercent": round((memory_usage / memory_limit * 100) if memory_limit > 0 else 0, 2),
                    "networkRx": round(rx_bytes, 2),  # In MB
                    "networkTx": round(tx_bytes, 2),  # In MB
                    "blockRead": round(block_read, 2),  # In MB
                    "blockWrite": round(block_write, 2),  # In MB
                    "pids": stats.get('pids_stats', {}).get('current', 0),
                    "status": "running"
                },
                "timestamp": datetime.utcnow().isoformat()
            }

            logger.debug(f"Container stats: CPU: {stats_payload['payload']['cpuUsage']}%, " + \
                      f"Memory: {stats_payload['payload']['memoryUsage']}MB/{stats_payload['payload']['memoryLimit']}MB " + \
                      f"({stats_payload['payload']['memoryPercent']}%)")
            
            return stats_payload
            
        except Exception as e:
            logger.error(f"Error calculating metrics: {e}")
            return {
                "type": "error",
                "error": f"Error calculating metrics: {str(e)}",
                "timestamp": datetime.utcnow().isoformat()
            }
    
    async def stream_container_stats(self, websocket: WebSocket, container_id: str):
        """Stream container stats to WebSocket"""
        client = self._get_docker_client()
        if not client:
            await websocket.send_json({
                "type": "error",
                "error": "Docker daemon not available",
                "timestamp": datetime.utcnow().isoformat()
            })
            return
            
        try:
            container = client.containers.get(container_id)
            last_cpu_stats = None
            last_system_cpu_usage = None
            
            # Send initial stats
            initial_stats = container.stats(stream=False, decode=True)
            await websocket.send_json(self._calculate_metrics(initial_stats))
            
            # Start streaming stats
            async def stream_stats():
                nonlocal last_cpu_stats, last_system_cpu_usage
                
                for stats in container.stats(stream=True, decode=True):
                    try:
                        # Update CPU usage history
                        if last_cpu_stats is None:
                            last_cpu_stats = stats['precpu_stats']
                            last_system_cpu_usage = stats['precpu_stats'].get('system_cpu_usage', 0)
                        
                        # Calculate metrics
                        metrics = self._calculate_metrics(stats)
                        await websocket.send_json(metrics)
                        
                        # Update last stats
                        last_cpu_stats = stats['cpu_stats']
                        last_system_cpu_usage = stats['cpu_stats'].get('system_cpu_usage', 0)
                        
                        await asyncio.sleep(1)  # Update every second
                    except Exception as e:
                        logger.error(f"Error sending stats or connection lost: {e}")
                        break
            
            # Create and store the streaming task
            task = asyncio.create_task(stream_stats())
            self.active_tasks[container_id] = task
            
            try:
                await task
            except asyncio.CancelledError:
                logger.info(f"Stats streaming cancelled for container {container_id}")
                
        except docker.errors.NotFound:
            await websocket.send_json({
                "type": "error",
                "error": f"Container {container_id} not found",
                "timestamp": datetime.utcnow().isoformat()
            })
        except Exception as e:
            logger.error(f"Error streaming stats for {container_id}: {e}")
            await websocket.send_json({
                "type": "error",
                "error": f"Error streaming stats: {str(e)}",
                "timestamp": datetime.utcnow().isoformat()
            })
        finally:
            if container_id in self.active_tasks:
                del self.active_tasks[container_id]

# Create router
router = APIRouter()

# Create global streamer instance
stats_streamer = StatsStreamer()

@router.websocket("/ws/stats/{container_id}")
async def websocket_stats_endpoint(websocket: WebSocket, container_id: str):
    """WebSocket endpoint for container stats"""
    await websocket.accept()
    await stats_streamer.stream_container_stats(websocket, container_id)

class StatsStreamer:
    """Stream container statistics via WebSocket with enhanced metrics calculation"""
    
    def __init__(self):
        self.client = None
        self.active_tasks: Dict[str, asyncio.Task] = {}
        self._docker_cli_available = None
        self._docker_cli_check_time = None
        
    def _get_docker_client(self):
        """Check Docker CLI availability (SDK client disabled due to URL scheme issues)"""
        if self._docker_cli_available is None:
            try:
                import subprocess
                result = subprocess.run(['docker', 'version'], 
                                     capture_output=True, text=True, timeout=5)
                self._docker_cli_available = result.returncode == 0
                if self._docker_cli_available:
                    logger.info("Docker CLI is available")
                else:
                    logger.warning("Docker CLI is not available")
            except Exception as e:
                logger.error(f"Failed to check Docker CLI: {e}")
                self._docker_cli_available = False
        return 'cli' if self._docker_cli_available else None
        
    def _calculate_metrics(self, stats: dict) -> dict:
        """Calculate container metrics from Docker stats"""
        try:
            # CPU Usage calculation
            cpu_delta = stats['cpu_stats']['cpu_usage']['total_usage'] - \
                       stats['precpu_stats']['cpu_usage']['total_usage']
            system_cpu_delta = stats['cpu_stats']['system_cpu_usage'] - \
                             stats['precpu_stats']['system_cpu_usage']
            online_cpus = stats['cpu_stats'].get('online_cpus', 
                len(stats['cpu_stats']['cpu_usage'].get('percpu_usage', [1])))
            
            if system_cpu_delta > 0 and cpu_delta > 0:
                # Calculate CPU usage percentage for all cores
                cpu_usage = (cpu_delta / system_cpu_delta) * online_cpus * 100.0
            else:
                cpu_usage = 0.0
            
            # Memory Usage (in bytes)
            memory_stats = stats.get('memory_stats', {})
            memory_usage = memory_stats.get('usage', 0)
            if 'stats' in memory_stats:
                # Cache and buffer memory should not be counted as used memory
                cache = memory_stats['stats'].get('cache', 0)
                memory_usage = memory_usage - cache
                
            memory_limit = memory_stats.get('limit', 0)
            
            if memory_limit == 0:
                memory_limit = 1  # Avoid division by zero
                
            # Convert to megabytes for better readability
            memory_usage = memory_usage / (1024 * 1024)  # Convert to MB
            memory_limit = memory_limit / (1024 * 1024)  # Convert to MB
            
            # Network stats (convert to MB)
            networks = stats.get('networks', {})
            rx_bytes = sum(net.get('rx_bytes', 0) for net in networks.values()) / (1024 * 1024)
            tx_bytes = sum(net.get('tx_bytes', 0) for net in networks.values()) / (1024 * 1024)
            
            # Block I/O stats (convert to MB)
            block_stats = stats.get('blkio_stats', {})
            block_read = 0
            block_write = 0
            
            # Calculate block I/O in MB
            for stat in block_stats.get('io_service_bytes_recursive', []):
                if stat['op'] == 'Read':
                    block_read += stat['value']
                elif stat['op'] == 'Write':
                    block_write += stat['value']
            
            block_read = block_read / (1024 * 1024)
            block_write = block_write / (1024 * 1024)
            
            # Format values for better precision and readability
            stats_payload = {
                "type": "stats",
                "payload": {
                    "cpuUsage": round(cpu_usage, 2),
                    "cpuCount": online_cpus,
                    "memoryUsage": round(memory_usage, 2),  # In MB
                    "memoryLimit": round(memory_limit, 2),  # In MB
                    "memoryPercent": round((memory_usage / memory_limit * 100) if memory_limit > 0 else 0, 2),
                    "networkRx": round(rx_bytes, 2),  # In MB
                    "networkTx": round(tx_bytes, 2),  # In MB
                    "blockRead": round(block_read, 2),  # In MB
                    "blockWrite": round(block_write, 2),  # In MB
                    "pids": stats.get('pids_stats', {}).get('current', 0),
                    "status": "running"
                },
                "timestamp": datetime.utcnow().isoformat()
            }

            logger.debug(f"Container stats: CPU: {stats_payload['payload']['cpuUsage']}%, " + \
                      f"Memory: {stats_payload['payload']['memoryUsage']}MB/{stats_payload['payload']['memoryLimit']}MB " + \
                      f"({stats_payload['payload']['memoryPercent']}%)")
            
            return stats_payload
            
        except Exception as e:
            logger.error(f"Error calculating metrics: {e}")
            return {
                "type": "error",
                "error": f"Error calculating metrics: {str(e)}",
                "timestamp": datetime.utcnow().isoformat()
            }
    
    async def stream_container_stats(self, websocket: WebSocket, container_id: str):
        """Stream container stats to WebSocket"""
        client = self._get_docker_client()
        if not client:
            await websocket.send_json({
                "type": "error",
                "error": "Docker daemon not available",
                "timestamp": datetime.utcnow().isoformat()
            })
            return
            
        try:
            container = client.containers.get(container_id)
            last_cpu_stats = None
            last_system_cpu_usage = None
            
            # Send initial stats
            initial_stats = container.stats(stream=False, decode=True)
            await websocket.send_json(self._calculate_metrics(initial_stats))
            
            # Start streaming stats
            async def stream_stats():
                nonlocal last_cpu_stats, last_system_cpu_usage
                
                for stats in container.stats(stream=True, decode=True):
                    try:
                        # Update CPU usage history
                        if last_cpu_stats is None:
                            last_cpu_stats = stats['precpu_stats']
                            last_system_cpu_usage = stats['precpu_stats'].get('system_cpu_usage', 0)
                        
                        # Calculate metrics
                        metrics = self._calculate_metrics(stats)
                        await websocket.send_json(metrics)
                        
                        # Update last stats
                        last_cpu_stats = stats['cpu_stats']
                        last_system_cpu_usage = stats['cpu_stats'].get('system_cpu_usage', 0)
                        
                        await asyncio.sleep(1)  # Update every second
                    except Exception as e:
                        logger.error(f"Error sending stats or connection lost: {e}")
                        break
            
            # Create and store the streaming task
            task = asyncio.create_task(stream_stats())
            self.active_tasks[container_id] = task
            
            try:
                await task
            except asyncio.CancelledError:
                logger.info(f"Stats streaming cancelled for container {container_id}")
                
        except docker.errors.NotFound:
            await websocket.send_json({
                "type": "error",
                "error": f"Container {container_id} not found",
                "timestamp": datetime.utcnow().isoformat()
            })
        except Exception as e:
            logger.error(f"Error streaming stats for {container_id}: {e}")
            await websocket.send_json({
                "type": "error",
                "error": f"Error streaming stats: {str(e)}",
                "timestamp": datetime.utcnow().isoformat()
            })
        finally:
            if container_id in self.active_tasks:
                del self.active_tasks[container_id]

# Note: We've removed the redundant websocket_stats function since websocket_stats_endpoint provides the same functionality

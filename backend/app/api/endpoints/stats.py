import asyncio
import json
import logging
import re
from typing import Dict, Optional
from fastapi import WebSocket, WebSocketDisconnect, APIRouter
from datetime import datetime

logger = logging.getLogger(__name__)

class StatsStreamer:
    """Stream container statistics via WebSocket using Docker CLI"""
    
    def __init__(self):
        self.active_tasks: Dict[str, asyncio.Task] = {}
        self._docker_cli_available = None
        
    async def _check_docker_cli(self) -> bool:
        """Check Docker CLI availability"""
        if self._docker_cli_available is None:
            try:
                proc = await asyncio.create_subprocess_exec(
                    'docker', 'version',
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                stdout, stderr = await proc.communicate()
                self._docker_cli_available = proc.returncode == 0
                if self._docker_cli_available:
                    logger.info("Docker CLI is available")
                else:
                    logger.warning("Docker CLI is not available")
            except Exception as e:
                logger.error(f"Failed to check Docker CLI: {e}")
                self._docker_cli_available = False
        return self._docker_cli_available
        
    def _parse_memory_value(self, value_str: str) -> float:
        """Parse memory value string to MB (e.g., '123.4MiB' -> 123.4)"""
        value_str = value_str.strip()
        if not value_str or value_str == '0':
            return 0.0
        
        # Extract numeric part and unit
        match = re.match(r'([0-9.]+)([A-Za-z]*)', value_str)
        if not match:
            return 0.0
        
        numeric_part = float(match.group(1))
        unit = match.group(2).upper()
        
        # Convert to MB
        if unit in ['B', 'BYTES']:
            return numeric_part / (1024 * 1024)
        elif unit in ['K', 'KB', 'KIB']:
            return numeric_part / 1024
        elif unit in ['M', 'MB', 'MIB']:
            return numeric_part
        elif unit in ['G', 'GB', 'GIB']:
            return numeric_part * 1024
        elif unit in ['T', 'TB', 'TIB']:
            return numeric_part * 1024 * 1024
        else:
            # Assume bytes if no unit
            return numeric_part / (1024 * 1024)

    async def _parse_docker_stats_cli(self, container_id: str) -> dict:
        """Get container stats using Docker CLI and parse the output"""
        try:
            proc = await asyncio.create_subprocess_exec(
                'docker', 'stats', '--no-stream', '--format', '{{json .}}', container_id,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, stderr = await proc.communicate()
            
            if proc.returncode != 0:
                logger.error(f"Docker stats command failed: {stderr.decode()}")
                return {
                    "type": "error",
                    "error": f"Docker stats failed: {stderr.decode()}",
                    "timestamp": datetime.utcnow().isoformat()
                }
            
            raw_stats = json.loads(stdout.decode())
            
            # Parse CLI format to structured format
            cpu_percent = float(raw_stats.get('CPUPerc', '0.00%').replace('%', ''))
            memory_usage_str = raw_stats.get('MemUsage', '0B / 0B')
            memory_percent = float(raw_stats.get('MemPerc', '0.00%').replace('%', ''))
            
            # Parse memory usage (e.g., "123.4MiB / 1.5GiB")
            memory_parts = memory_usage_str.split(' / ')
            memory_usage_mb = 0
            memory_limit_mb = 1
            
            if len(memory_parts) == 2:
                try:
                    # Convert memory values to MB
                    usage_str = memory_parts[0].strip()
                    limit_str = memory_parts[1].strip()
                    
                    memory_usage_mb = self._parse_memory_value(usage_str)
                    memory_limit_mb = self._parse_memory_value(limit_str)
                except Exception as e:
                    logger.warning(f"Error parsing memory values: {e}")
            
            # Parse network I/O (e.g., "1.2MB / 3.4MB")
            network_io = raw_stats.get('NetIO', '0B / 0B')
            network_parts = network_io.split(' / ')
            network_rx_mb = 0
            network_tx_mb = 0
            
            if len(network_parts) == 2:
                try:
                    network_rx_mb = self._parse_memory_value(network_parts[0].strip())
                    network_tx_mb = self._parse_memory_value(network_parts[1].strip())
                except Exception as e:
                    logger.warning(f"Error parsing network values: {e}")
            
            # Parse block I/O (e.g., "5.6MB / 7.8MB")
            block_io = raw_stats.get('BlockIO', '0B / 0B')
            block_parts = block_io.split(' / ')
            block_read_mb = 0
            block_write_mb = 0
            
            if len(block_parts) == 2:
                try:
                    block_read_mb = self._parse_memory_value(block_parts[0].strip())
                    block_write_mb = self._parse_memory_value(block_parts[1].strip())
                except Exception as e:
                    logger.warning(f"Error parsing block I/O values: {e}")
            
            pids = int(raw_stats.get('PIDs', '0'))
            
            stats_payload = {
                "type": "stats",
                "payload": {
                    "cpuUsage": round(cpu_percent, 2),
                    "cpuCount": 1,  # CLI doesn't provide CPU count easily
                    "memoryUsage": round(memory_usage_mb, 2),
                    "memoryLimit": round(memory_limit_mb, 2),
                    "memoryPercent": round(memory_percent, 2),
                    "networkRx": round(network_rx_mb, 2),
                    "networkTx": round(network_tx_mb, 2),
                    "blockRead": round(block_read_mb, 2),
                    "blockWrite": round(block_write_mb, 2),
                    "pids": pids,
                    "status": "running"
                },
                "timestamp": datetime.utcnow().isoformat()
            }
            
            logger.debug(f"Container {container_id} stats: CPU: {cpu_percent}%, Memory: {memory_usage_mb:.1f}MB/{memory_limit_mb:.1f}MB")
            return stats_payload
            
        except Exception as e:
            logger.error(f"Error getting container stats: {e}")
            return {
                "type": "error",
                "error": f"Error getting stats: {str(e)}",
                "timestamp": datetime.utcnow().isoformat()
            }
    
    async def stream_container_stats(self, websocket: WebSocket, container_id: str):
        """Stream container stats to WebSocket using Docker CLI"""
        # Accept WebSocket connection
        await websocket.accept()
        
        if not await self._check_docker_cli():
            await websocket.send_json({
                "type": "error",
                "error": "Docker CLI not available",
                "timestamp": datetime.utcnow().isoformat()
            })
            return
            
        # Send initial connection established message
        await websocket.send_json({
            "type": "connection_established",
            "container_id": container_id,
            "timestamp": datetime.utcnow().isoformat()
        })
            
        try:
            # Send initial stats
            initial_stats = await self._parse_docker_stats_cli(container_id)
            await websocket.send_json(initial_stats)
            
            # Start streaming stats
            async def stream_stats():
                while True:
                    try:
                        stats = await self._parse_docker_stats_cli(container_id)
                        await websocket.send_json(stats)
                        await asyncio.sleep(2)  # Update every 2 seconds
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
    logger.info(f"Stats WebSocket starting for container: {container_id}")
    
    try:
        await stats_streamer.stream_container_stats(websocket, container_id)
    except WebSocketDisconnect:
        logger.info(f"Stats WebSocket disconnected for container: {container_id}")
    except Exception as e:
        logger.error(f"Stats WebSocket error for container {container_id}: {e}")
    finally:
        # Clean up any active tasks
        if container_id in stats_streamer.active_tasks:
            task = stats_streamer.active_tasks.pop(container_id, None)
            if task and not task.done():
                task.cancel()

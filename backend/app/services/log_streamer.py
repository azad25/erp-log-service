import asyncio
import json
import logging
from typing import Dict, List, Optional, Set
from fastapi import WebSocket
from datetime import datetime, timedelta
import docker
from app.core.config import settings
from .log_processor import LogProcessor
from collections import deque
import weakref

logger = logging.getLogger(__name__)

class LogStreamer:
    """Stream logs from Docker containers via WebSocket"""
    
    def __init__(self):
        # Initialize without blocking Docker client connection
        self.client = None
        self.processor = LogProcessor()
        self.active_tasks: Dict[str, asyncio.Task] = {}
        self.active_containers: Set[str] = set()
        self.websockets: Dict[str, Set[WebSocket]] = {}
        self.max_logs_per_container = 1000
        # Use deque for better performance on append/pop operations
        self.log_buffer: Dict[str, deque] = {}
        
        # Connection health tracking
        self._connection_health: Dict[WebSocket, float] = weakref.WeakKeyDictionary()
        
        # Batch processing for better performance
        self._batch_queue: Dict[str, List[Dict]] = {}
        self._batch_size = 10
        self._batch_timeout = 0.1  # 100ms
        self._batch_tasks: Dict[str, asyncio.Task] = {}
        
        # Docker CLI validation cache
        self._docker_cli_available = None
        self._docker_cli_check_time = None
        
    def _get_docker_client(self):
        """Lazy initialization of Docker client using CLI with caching"""
        current_time = datetime.now()
        
        # Cache Docker CLI availability for 30 seconds
        if (self._docker_cli_available is not None and 
            self._docker_cli_check_time and 
            (current_time - self._docker_cli_check_time).total_seconds() < 30):
            return self.client if self._docker_cli_available else None

        try:
            # Test Docker CLI access with shorter timeout
            import subprocess
            result = subprocess.run(
                ['docker', 'version', '--format', '{{.Client.Version}}'],
                capture_output=True,
                text=True,
                timeout=5  # Reduced timeout
            )
            
            if result.returncode == 0:
                logger.info("Successfully connected to Docker using CLI")
                self.client = 'cli'
                self._docker_cli_available = True
                self._docker_cli_check_time = current_time
                return self.client
            else:
                logger.error(f"Docker CLI failed with error: {result.stderr}")
                
        except Exception as e:
            logger.error(f"Error using Docker CLI: {str(e)}")
            
        self.client = None
        self._docker_cli_available = False
        self._docker_cli_check_time = current_time
        return None
    
    async def add_websocket(self, websocket: WebSocket, container_id: str = 'all') -> None:
        """Add a new WebSocket connection with improved error handling"""
        try:
            if container_id not in self.websockets:
                self.websockets[container_id] = set()
            
            self.websockets[container_id].add(websocket)
            self._connection_health[websocket] = datetime.now().timestamp()
            
            logger.info(f"Added WebSocket for container {container_id}. Total connections: {len(self.websockets[container_id])}")
            
            # Start streaming for this container if not already started
            if container_id != 'all' and container_id not in self.active_containers:
                await self.start_streaming(container_id)
            
            # Send initial logs if available (non-blocking)
            if container_id in self.log_buffer and self.log_buffer[container_id]:
                asyncio.create_task(self._send_initial_logs(websocket, container_id))
                
        except Exception as e:
            logger.error(f"Error adding WebSocket for container {container_id}: {str(e)}")
            raise
    
    async def remove_websocket(self, websocket: WebSocket, container_id: str = 'all') -> None:
        """Remove a WebSocket connection with improved cleanup"""
        try:
            if container_id in self.websockets:
                self.websockets[container_id].discard(websocket)  # Use discard to avoid KeyError
                logger.info(f"Removed WebSocket for container {container_id}. Remaining connections: {len(self.websockets[container_id])}")
                
                if not self.websockets[container_id]:
                    del self.websockets[container_id]
                    logger.info(f"No more WebSockets for container {container_id}, cleaning up...")
                    
                    # Stop streaming if no more clients for this container
                    if container_id != 'all' and container_id in self.active_containers:
                        await self.stop_streaming(container_id)
            
            # Clean up connection health tracking (handled automatically by weakref)
                        
        except Exception as e:
            logger.error(f"Error removing WebSocket for container {container_id}: {str(e)}")
            # Don't re-raise here to prevent cascading errors
    
    async def _send_initial_logs(self, websocket: WebSocket, container_id: str):
        """Send initial logs to a new WebSocket connection with rate limiting"""
        try:
            if container_id in self.log_buffer:
                # Send logs in batches to avoid overwhelming the client
                logs = list(self.log_buffer[container_id])
                batch_size = 50
                
                for i in range(0, len(logs), batch_size):
                    batch = logs[i:i + batch_size]
                    for log in batch:
                        await websocket.send_json(log)
                    # Small delay between batches
                    if i + batch_size < len(logs):
                        await asyncio.sleep(0.01)
                        
        except Exception as e:
            logger.error(f"Error sending initial logs: {str(e)}")
            # Remove the problematic websocket
            await self.remove_websocket(websocket, container_id)

    async def start_streaming(self, container_id: str):
        """Start streaming logs for a container with duplicate prevention"""
        if container_id in self.active_tasks and not self.active_tasks[container_id].done():
            logger.debug(f"Streaming already active for container {container_id}")
            return

        self.active_containers.add(container_id)
        
        # Cancel existing task if it exists but is done
        if container_id in self.active_tasks:
            self.active_tasks[container_id].cancel()
        
        self.active_tasks[container_id] = asyncio.create_task(self._stream_logs(container_id))
        logger.info(f"Started streaming for container {container_id}")

    async def stop_streaming(self, container_id: str):
        """Stop streaming logs for a container with proper cleanup"""
        if container_id in self.active_tasks:
            task = self.active_tasks[container_id]
            if not task.done():
                task.cancel()
                try:
                    await asyncio.wait_for(task, timeout=2.0)
                except (asyncio.CancelledError, asyncio.TimeoutError):
                    pass
            del self.active_tasks[container_id]
        
        self.active_containers.discard(container_id)
        
        # Clean up batch processing
        if container_id in self._batch_tasks:
            self._batch_tasks[container_id].cancel()
            del self._batch_tasks[container_id]
        
        if container_id in self._batch_queue:
            del self._batch_queue[container_id]
            
        logger.info(f"Stopped streaming for container {container_id}")
    
    async def _stream_logs(self, container_id: str):
        """Stream logs from a container using Docker CLI asynchronously with improved error handling"""
        from asyncio.subprocess import PIPE
        
        # Check if we can use Docker CLI
        if self._get_docker_client() != 'cli':
            logger.error("Docker CLI not available for streaming")
            return
        
        # Initialize log buffer for this container if it doesn't exist
        if container_id not in self.log_buffer:
            self.log_buffer[container_id] = deque(maxlen=self.max_logs_per_container)
        
        container_name = None
        process = None
        
        try:
            # Get container info with timeout
            process = await asyncio.create_subprocess_exec(
                'docker', 'inspect', container_id, '--format', '{{.Name}}',
                stdout=PIPE,
                stderr=PIPE
            )
            
            try:
                stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=10.0)
            except asyncio.TimeoutError:
                logger.error(f"Timeout getting container info for {container_id}")
                if process.returncode is None:
                    process.terminate()
                return
            
            if process.returncode != 0 or not stdout:
                logger.error(f"Error getting container info for {container_id}: {stderr.decode() if stderr else 'No output'}")
                return
                
            container_name = stdout.decode().strip().lstrip('/')
            logger.info(f"Starting log stream for container: {container_name} ({container_id})")
            
            # Get initial logs with limited history
            process = await asyncio.create_subprocess_exec(
                'docker', 'logs', '--tail', '50', '--timestamps', container_id,  # Reduced from 100 to 50
                stdout=PIPE,
                stderr=PIPE
            )
            
            # Process initial logs with timeout
            try:
                stdout, _ = await asyncio.wait_for(process.communicate(), timeout=15.0)
                if stdout:
                    lines = stdout.decode().splitlines()
                    for line in lines[-50:]:  # Only process last 50 lines
                        if line.strip():
                            await self._process_log_line_fast(line, container_id, container_name)
            except asyncio.TimeoutError:
                logger.warning(f"Timeout processing initial logs for {container_id}")
                if process.returncode is None:
                    process.terminate()
            
            # Start streaming new logs
            process = await asyncio.create_subprocess_exec(
                'docker', 'logs', '--follow', '--tail', '0', '--timestamps', container_id,
                stdout=PIPE,
                stderr=PIPE
            )
            
            # Set up batch processing for this container
            self._batch_queue[container_id] = []
            self._batch_tasks[container_id] = asyncio.create_task(
                self._batch_processor(container_id)
            )
            
            # Buffer for reading lines efficiently
            buffer = b''
            
            while True:
                # Read data in chunks for better performance
                try:
                    chunk = await asyncio.wait_for(process.stdout.read(4096), timeout=1.0)
                except asyncio.TimeoutError:
                    # Check if process is still alive
                    if process.returncode is not None:
                        break
                    continue
                
                if not chunk:
                    break
                    
                buffer += chunk
                
                # Process complete lines
                while b'\n' in buffer:
                    line, buffer = buffer.split(b'\n', 1)
                    line_str = line.decode('utf-8', errors='replace').strip()
                    
                    if line_str:
                        await self._process_log_line_fast(line_str, container_id, container_name)
                        
        except asyncio.CancelledError:
            logger.info(f"Log streaming cancelled for container {container_id}")
            raise
            
        except Exception as e:
            logger.error(f"Error in log stream for {container_id}: {str(e)}")
            # Implement exponential backoff for restarts
            await asyncio.sleep(min(5 * (len([t for t in self.active_tasks.values() if t.done()])), 60))
            
        finally:
            # Cleanup process
            if process and process.returncode is None:
                try:
                    process.terminate()
                    await asyncio.wait_for(process.wait(), timeout=3.0)
                except asyncio.TimeoutError:
                    process.kill()
                except Exception as e:
                    logger.error(f"Error terminating process: {str(e)}")
            
            # Clean up tasks and queues
            if container_id in self.active_tasks:
                del self.active_tasks[container_id]
            self.active_containers.discard(container_id)
            
            if container_id in self._batch_tasks:
                self._batch_tasks[container_id].cancel()
                del self._batch_tasks[container_id]
            
            if container_id in self._batch_queue:
                del self._batch_queue[container_id]
                
            logger.info(f"Stopped log streaming for container {container_id}")
            
            # Auto-restart if there are still active websockets and this wasn't a cancellation
            if (container_id in self.websockets and 
                self.websockets[container_id] and 
                container_id in self.active_containers):
                logger.info(f"Restarting log stream for {container_id} due to active connections")
                await asyncio.sleep(2)  # Brief delay before restart
                await self.start_streaming(container_id)
    
    async def _process_log_line_fast(self, line: str, container_id: str, container_name: str):
        """Fast log line processing with batching"""
        try:
            log_entry = await self.processor.process_log_line(line, container_id)
            log_entry['container_name'] = container_name
            
            # Add to buffer (deque automatically handles max length)
            self.log_buffer[container_id].append(log_entry)
            
            # Add to batch queue for processing
            if container_id in self._batch_queue:
                self._batch_queue[container_id].append(log_entry)
                
        except Exception as e:
            logger.error(f"Error processing log line: {str(e)}")
    
    async def _batch_processor(self, container_id: str):
        """Process logs in batches for better WebSocket performance"""
        try:
            while True:
                await asyncio.sleep(self._batch_timeout)
                
                if container_id not in self._batch_queue or not self._batch_queue[container_id]:
                    continue
                
                # Get batch of logs
                batch = self._batch_queue[container_id][:self._batch_size]
                self._batch_queue[container_id] = self._batch_queue[container_id][self._batch_size:]
                
                if not batch:
                    continue
                
                # Send batch to WebSockets
                for log_entry in batch:
                    await self._broadcast_log_fast(log_entry, container_id)
                    
                    # Also broadcast to 'all' connections
                    if container_id != 'all':
                        await self._broadcast_log_fast(log_entry, 'all')
                        
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"Error in batch processor for {container_id}: {str(e)}")
    
    async def _broadcast_log_fast(self, log_entry: Dict, container_id: str) -> None:
        """Fast broadcast with improved error handling and cleanup"""
        if container_id not in self.websockets or not self.websockets[container_id]:
            return
            
        disconnected = []
        websockets_copy = list(self.websockets[container_id])  # Create copy to avoid modification during iteration
        
        # Use asyncio.gather for concurrent sending (with error handling)
        async def send_to_websocket(ws):
            try:
                await ws.send_json(log_entry)
                return ws, None
            except Exception as e:
                return ws, e
        
        # Send to all websockets concurrently
        if len(websockets_copy) > 1:
            results = await asyncio.gather(
                *[send_to_websocket(ws) for ws in websockets_copy],
                return_exceptions=True
            )
            
            for result in results:
                if isinstance(result, tuple):
                    ws, error = result
                    if error:
                        disconnected.append(ws)
                elif isinstance(result, Exception):
                    logger.error(f"Unexpected error in broadcast: {result}")
        else:
            # Single websocket - send directly
            for ws in websockets_copy:
                try:
                    await ws.send_json(log_entry)
                except Exception as e:
                    if "WebSocket is not connected" in str(e) or "WebSocket is already closed" in str(e):
                        disconnected.append(ws)
                    else:
                        logger.error(f"Error sending log to WebSocket: {str(e)}")
                        disconnected.append(ws)
        
        # Clean up disconnected WebSockets
        if disconnected:
            logger.info(f"Cleaning up {len(disconnected)} disconnected WebSockets for container {container_id}")
            for ws in disconnected:
                self.websockets[container_id].discard(ws)
            
            # Remove empty container entry
            if not self.websockets[container_id]:
                del self.websockets[container_id]
                if container_id != 'all' and container_id in self.active_containers:
                    asyncio.create_task(self.stop_streaming(container_id))
    
    async def check_websocket_health(self):
        """Periodically check WebSocket health and clean up dead connections"""
        try:
            current_time = datetime.now().timestamp()
            containers_to_check = list(self.websockets.keys())
            
            for container_id in containers_to_check:
                if container_id not in self.websockets:
                    continue
                    
                dead_websockets = []
                
                for ws in list(self.websockets[container_id]):
                    try:
                        # Try to ping the WebSocket
                        await ws.ping()
                        self._connection_health[ws] = current_time
                    except Exception:
                        dead_websockets.append(ws)
                
                # Remove dead WebSockets
                for ws in dead_websockets:
                    await self.remove_websocket(ws, container_id)
                    
        except Exception as e:
            logger.error(f"Error in WebSocket health check: {str(e)}")

    async def stop_all(self):
        """Stop all log streaming tasks with proper cleanup"""
        logger.info("Stopping all log streaming tasks...")
        
        # Cancel all active tasks
        tasks_to_cancel = list(self.active_tasks.values())
        batch_tasks_to_cancel = list(self._batch_tasks.values())
        
        for task in tasks_to_cancel + batch_tasks_to_cancel:
            if not task.done():
                task.cancel()
        
        # Wait for all tasks to complete
        if tasks_to_cancel or batch_tasks_to_cancel:
            await asyncio.gather(*tasks_to_cancel, *batch_tasks_to_cancel, return_exceptions=True)
        
        # Clear all data structures
        self.active_tasks.clear()
        self.active_containers.clear()
        self.websockets.clear()
        self.log_buffer.clear()
        self._batch_queue.clear()
        self._batch_tasks.clear()
        
        logger.info("All log streaming tasks stopped")

# Global instance - initialized lazily
log_streamer = None

def get_log_streamer():
    """Get or create the global log streamer instance"""
    global log_streamer
    if log_streamer is None:
        log_streamer = LogStreamer()
    return log_streamer
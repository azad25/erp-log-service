import asyncio
import json
import logging
from typing import Dict, List, Optional, Set
from fastapi import WebSocket
from datetime import datetime, timedelta
import docker
from app.core.config import settings
from .log_processor import LogProcessor

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
        self.log_buffer: Dict[str, List[Dict]] = {}
        
    def _get_docker_client(self):
        """Lazy initialization of Docker client using CLI"""
        if self.client is not None:
            return self.client

        try:
            # Test Docker CLI access
            import subprocess
            result = subprocess.run(
                ['docker', 'ps', '--format', '{{.ID}}'],
                capture_output=True,
                text=True,
                timeout=10
            )
            
            if result.returncode == 0:
                logger.info("Successfully connected to Docker using CLI")
                self.client = 'cli'  # Mark that we're using CLI
                return self.client
            else:
                logger.error(f"Docker CLI failed with error: {result.stderr}")
                
        except Exception as e:
            logger.error(f"Error using Docker CLI: {str(e)}")
            
        self.client = None
        return None
        return self.client
    
    async def add_websocket(self, websocket: WebSocket, container_id: str = 'all') -> None:
        """Add a new WebSocket connection"""
        try:
            if container_id not in self.websockets:
                self.websockets[container_id] = set()
            self.websockets[container_id].add(websocket)
            logger.info(f"Added WebSocket for container {container_id}. Total connections: {len(self.websockets[container_id])}")
            
            # Start streaming for this container if not already started
            if container_id != 'all' and container_id not in self.active_containers:
                await self.start_streaming(container_id)
            
            # Send initial logs if available
            if container_id in self.log_buffer and self.log_buffer[container_id]:
                await self._send_initial_logs(websocket, container_id)
                
        except Exception as e:
            logger.error(f"Error adding WebSocket for container {container_id}: {str(e)}")
            raise
    
    async def remove_websocket(self, websocket: WebSocket, container_id: str = 'all') -> None:
        """Remove a WebSocket connection"""
        try:
            if container_id in self.websockets:
                if websocket in self.websockets[container_id]:
                    self.websockets[container_id].remove(websocket)
                    logger.info(f"Removed WebSocket for container {container_id}. Remaining connections: {len(self.websockets[container_id])}")
                
                if not self.websockets[container_id]:
                    del self.websockets[container_id]
                    logger.info(f"No more WebSockets for container {container_id}, cleaning up...")
                    
                    # Stop streaming if no more clients for this container
                    if container_id != 'all' and container_id in self.active_containers:
                        await self.stop_streaming(container_id)
                        
        except Exception as e:
            logger.error(f"Error removing WebSocket for container {container_id}: {str(e)}")
            raise
    
    async def _send_initial_logs(self, websocket: WebSocket, container_id: str):
        """Send initial logs to a new WebSocket connection"""
        if container_id in self.log_buffer:
            for log in self.log_buffer[container_id]:
                await websocket.send_json(log)

    async def start_streaming(self, container_id: str):
        """Start streaming logs for a container"""
        if container_id in self.active_tasks:
            return

        self.active_containers.add(container_id)
        self.active_tasks[container_id] = asyncio.create_task(self._stream_logs(container_id))

    async def stop_streaming(self, container_id: str):
        """Stop streaming logs for a container"""
        if container_id in self.active_tasks:
            self.active_tasks[container_id].cancel()
            del self.active_tasks[container_id]
            self.active_containers.discard(container_id)
    
    async def _stream_logs(self, container_id: str):
        """Stream logs from a container using Docker CLI asynchronously"""
        import asyncio
        from asyncio.subprocess import PIPE
        
        # Check if we can use Docker CLI
        if self._get_docker_client() != 'cli':
            logger.error("Docker CLI not available for streaming")
            return
        
        # Initialize log buffer for this container if it doesn't exist
        if container_id not in self.log_buffer:
            self.log_buffer[container_id] = []
        
        # Get container info
        try:
            process = await asyncio.create_subprocess_exec(
                'docker', 'inspect', container_id,
                stdout=PIPE,
                stderr=PIPE
            )
            stdout, stderr = await process.communicate()
            
            if process.returncode != 0 or not stdout:
                logger.error(f"Error getting container info: {stderr.decode()}")
                return
                
            container_info = json.loads(stdout.decode())[0]
            container_name = container_info.get('Name', '').lstrip('/')
            logger.info(f"Starting log stream for container: {container_name} ({container_id})")
            
            # Get initial logs
            process = await asyncio.create_subprocess_exec(
                'docker', 'logs', '--tail', '100', '--timestamps', container_id,
                stdout=PIPE,
                stderr=PIPE
            )
            
            # Process initial logs
            stdout, _ = await process.communicate()
            if stdout:
                for line in stdout.decode().splitlines():
                    if line.strip():
                        try:
                            await self._process_log_line(line, container_id, container_name)
                        except Exception as e:
                            logger.error(f"Error processing initial log line: {str(e)}")
                            continue
            
            # Start streaming new logs
            process = await asyncio.create_subprocess_exec(
                'docker', 'logs', '--follow', '--tail', '0', '--timestamps', container_id,
                stdout=PIPE,
                stderr=PIPE
            )
            
            try:
                # Continuously read from the process stdout
                while True:
                    line = await process.stdout.readline()
                    if not line:
                        break
                        
                    line = line.decode().strip()
                    if line:
                        try:
                            await self._process_log_line(line, container_id, container_name)
                        except Exception as e:
                            logger.error(f"Error processing log line: {str(e)}")
                            continue
                        
            except asyncio.CancelledError:
                logger.info(f"Log streaming cancelled for container {container_id}")
                if process.returncode is None:
                    process.terminate()
                    try:
                        await asyncio.wait_for(process.wait(), timeout=5.0)
                    except asyncio.TimeoutError:
                        process.kill()
                raise
                
            finally:
                # Clean up
                if container_id in self.active_tasks:
                    del self.active_tasks[container_id]
                self.active_containers.discard(container_id)
                logger.info(f"Stopped log streaming for container {container_id}")
                
        except Exception as e:
            logger.error(f"Error in log stream for {container_id}: {str(e)}")
            # Try to restart the stream after a delay
            await asyncio.sleep(5)
            if container_id in self.active_containers:
                logger.info(f"Restarting log stream for {container_id}")
                await self.start_streaming(container_id)
    
    async def _process_log_line(self, line: str, container_id: str, container_name: str):
        """Process a log line and broadcast to connected clients
        
        Args:
            line: The log line to process
            container_id: ID of the container
            container_name: Name of the container
        """
        try:
            log_entry = await self.processor.process_log_line(line, container_id)
            log_entry['container_name'] = container_name  # Ensure container_name is set
            
            # Add to buffer
            if container_id not in self.log_buffer:
                self.log_buffer[container_id] = []
            
            self.log_buffer[container_id].append(log_entry)
            
            # Keep buffer size manageable
            if len(self.log_buffer[container_id]) > self.max_logs_per_container:
                self.log_buffer[container_id] = self.log_buffer[container_id][-self.max_logs_per_container:]
            
            # Broadcast to all relevant WebSocket connections
            await self._broadcast_log(log_entry, container_id)
            
            # Also broadcast to 'all' connections
            if container_id != 'all':
                await self._broadcast_log(log_entry, 'all')
                
        except Exception as e:
            logger.error(f"Error processing log line: {str(e)}")
    
    async def _broadcast_log(self, log_entry: Dict, container_id: str) -> None:
        """Broadcast a log entry to all connected WebSockets"""
        if container_id not in self.websockets or not self.websockets[container_id]:
            return
            
        disconnected = set()
        
        for websocket in list(self.websockets[container_id]):  # Create a copy to iterate over
            try:
                await websocket.send_json(log_entry)
            except RuntimeError as e:
                # Check if the WebSocket is disconnected
                if "WebSocket is not connected" in str(e) or "WebSocket is already closed" in str(e):
                    disconnected.add(websocket)
                else:
                    logger.error(f"Error sending log to WebSocket: {str(e)}")
            except Exception as e:
                logger.error(f"Unexpected error sending log to WebSocket: {str(e)}")
                disconnected.add(websocket)
        
        # Clean up disconnected WebSockets
        if disconnected:
            logger.info(f"Cleaning up {len(disconnected)} disconnected WebSockets for container {container_id}")
            for ws in disconnected:
                try:
                    await self.remove_websocket(ws, container_id)
                except Exception as e:
                    logger.error(f"Error cleaning up WebSocket: {str(e)}")
    
    async def stop_all(self):
        """Stop all log streaming tasks"""
        for container_id in list(self.active_tasks.keys()):
            await self.stop_streaming(container_id)
        self.active_containers.clear()
        self.websockets.clear()
        self.log_buffer.clear()

# Global instance - initialized lazily
log_streamer = None

def get_log_streamer():
    """Get or create the global log streamer instance"""
    global log_streamer
    if log_streamer is None:
        log_streamer = LogStreamer()
    return log_streamer

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
        """Lazy initialization of Docker client"""
        if self.client is None:
            try:
                self.client = docker.DockerClient(base_url=settings.DOCKER_SOCKET)
                # Test connection
                self.client.ping()
            except Exception as e:
                logging.warning(f"Docker client initialization failed: {e}")
                # Fallback to default Docker client
                try:
                    self.client = docker.from_env()
                except Exception as fallback_error:
                    logging.error(f"Fallback Docker client also failed: {fallback_error}")
                    self.client = None
        return self.client
    
    async def add_websocket(self, websocket: WebSocket, container_id: str = 'all'):
        """Add a new WebSocket connection"""
        if container_id not in self.websockets:
            self.websockets[container_id] = set()
        self.websockets[container_id].add(websocket)
        
        # Start streaming for this container if not already started
        if container_id != 'all' and container_id not in self.active_containers:
            await self.start_streaming(container_id)
        
        # Send initial logs if available
        if container_id in self.log_buffer:
            await self._send_initial_logs(websocket, container_id)
    
    async def remove_websocket(self, websocket: WebSocket, container_id: str = 'all'):
        """Remove a WebSocket connection"""
        if container_id in self.websockets:
            self.websockets[container_id].discard(websocket)
            if not self.websockets[container_id]:
                del self.websockets[container_id]
                
                # Stop streaming if no more clients for this container
                if container_id != 'all' and container_id in self.active_containers:
                    await self.stop_streaming(container_id)
    
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
        """Stream logs from a container"""
        try:
            client = self._get_docker_client()
            if client is None:
                logger.error("Docker client not available for streaming")
                return
            container = client.containers.get(container_id)
            
            # Start with a small number of logs to avoid overwhelming the client
            initial_logs = container.logs(
                tail=100,
                follow=False,
                timestamps=True,
                stdout=True,
                stderr=True
            ).decode('utf-8', errors='replace').split('\n')
            
            # Process initial logs
            for line in initial_logs:
                if line.strip():
                    await self._process_log_line(line, container_id)
            
            # Stream new logs
            log_stream = container.logs(
                follow=True,
                timestamps=True,
                stream=True,
                stdout=True,
                stderr=True
            )
            
            for log_chunk in log_stream:
                try:
                    line = log_chunk.decode('utf-8', errors='replace').strip()
                    if line:
                        await self._process_log_line(line, container_id)
                except Exception as e:
                    logger.error(f"Error processing log chunk: {str(e)}")
        
        except Exception as e:
            logger.error(f"Error in log stream for {container_id}: {str(e)}")
            # Try to restart the stream after a delay
            await asyncio.sleep(5)
            if container_id in self.active_containers:
                logger.info(f"Restarting log stream for {container_id}")
                await self.start_streaming(container_id)
    
    async def _process_log_line(self, line: str, container_id: str):
        """Process a log line and broadcast to connected clients"""
        try:
            log_entry = await self.processor.process_log_line(line, container_id)
            
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
    
    async def _broadcast_log(self, log_entry: Dict, container_id: str):
        """Broadcast a log entry to all connected WebSockets"""
        if container_id not in self.websockets:
            return
            
        disconnected = set()
        
        for websocket in self.websockets[container_id]:
            try:
                await websocket.send_json(log_entry)
            except Exception as e:
                logger.error(f"Error sending log to WebSocket: {str(e)}")
                disconnected.add(websocket)
        
        # Clean up disconnected WebSockets
        for ws in disconnected:
            await self.remove_websocket(ws, container_id)
    
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

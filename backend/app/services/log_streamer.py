import asyncio
import json
import logging
import re
import time
from typing import Dict, List, Optional, Set, Any
from fastapi import WebSocket
from .docker import DockerService # Import DockerService
from datetime import datetime, timedelta, timezone
import weakref
from collections import deque
from app.core.config import settings
from .log_processor import LogProcessor
from starlette.websockets import WebSocketState

logger = logging.getLogger(__name__)

class LogStreamer:
    """Stream logs from Docker containers via LogProcessor and WebSocket with batching, rate-limiting and health checks"""

    def __init__(self):
        self.docker_service = DockerService() # Instantiate DockerService
        # Processor (do NOT start here — call start() in async context)
        self.processor = LogProcessor(docker_service=self.docker_service) # Pass docker_service to LogProcessor

        # Task management
        self.active_tasks: Dict[str, asyncio.Task] = {}
        self.active_containers: Set[str] = set()

        # WebSocket management using weak references (auto cleanup on GC)
        self.websockets: Dict[str, weakref.WeakSet] = {}  # container_id -> WeakSet[WebSocket]
        self.websocket_groups: weakref.WeakKeyDictionary = weakref.WeakKeyDictionary()  # WebSocket -> set(container_id)
        self._ws_lock = asyncio.Lock()

        # Real-time streaming only - no buffering of historical logs
        self._batch_queue: Dict[str, List[Dict[str, Any]]] = {}
        self._batch_size = 1  # Send logs immediately
        self._batch_timeout = 0.01  # Minimal batching delay
        self._batch_tasks: Dict[str, asyncio.Task] = {}

        # Connection tracking & filters (weak-key dictionaries use WebSocket objects as keys)
        self._connection_health: weakref.WeakKeyDictionary = weakref.WeakKeyDictionary()  # WebSocket -> timestamp
        self._connection_filters: weakref.WeakKeyDictionary = weakref.WeakKeyDictionary()  # WebSocket -> dict

        # Rate limiting (per-container sliding window of timestamps)
        self._rate_limits: Dict[str, deque] = {}
        self.rate_limit_interval = 1.0  # seconds
        self.rate_limit_max_messages = 100  # messages per interval

        # Docker CLI cache
        self._docker_cli_available: Optional[bool] = None
        self._docker_cli_check_time: Optional[datetime] = None
        
        # Log buffer for each container
        self.log_buffer: Dict[str, deque] = {}
        self.max_logs_per_container = 1000  # Maximum number of logs to keep in memory per container

        # Internal started flag
        self._started = False
        self._start_lock = asyncio.Lock()
        
        # Self-container detection cache
        self._self_container_id = None
        self._self_container_check_time = None

    # -------------------------
    # Self-container detection
    # -------------------------
    async def _is_self_container(self, container_id: str) -> bool:
        """Check if the given container ID is the log service itself"""
        try:
            # Cache the self-container ID for 5 minutes
            now = datetime.now()
            if (self._self_container_id is not None and 
                self._self_container_check_time and 
                (now - self._self_container_check_time).total_seconds() < 300):
                return container_id == self._self_container_id
            
            # Get current container ID by checking hostname or environment
            import socket
            import subprocess
            
            # Method 1: Try to get container ID from hostname (Docker sets hostname to container ID by default)
            hostname = socket.gethostname()
            if len(hostname) == 12 and all(c in '0123456789abcdef' for c in hostname):
                self._self_container_id = hostname
                self._self_container_check_time = now
                return container_id.startswith(hostname)
            
            # Method 2: Try to get container ID from /proc/self/cgroup
            try:
                with open('/proc/self/cgroup', 'r') as f:
                    for line in f:
                        if 'docker' in line and '/' in line:
                            # Extract container ID from cgroup path
                            parts = line.strip().split('/')
                            for part in parts:
                                if len(part) == 64 and all(c in '0123456789abcdef' for c in part):
                                    self._self_container_id = part[:12]  # Use short ID
                                    self._self_container_check_time = now
                                    return container_id.startswith(self._self_container_id)
            except (FileNotFoundError, PermissionError):
                pass
            
            # Method 3: Check if container name matches log service pattern
            try:
                result = subprocess.run(
                    ['docker', 'inspect', '--format', '{{.Name}}', container_id],
                    capture_output=True, text=True, timeout=5
                )
                if result.returncode == 0:
                    container_name = result.stdout.strip().lstrip('/')
                    if 'log-service' in container_name.lower():
                        self._self_container_id = container_id
                        self._self_container_check_time = now
                        return True
            except Exception:
                pass
            
            return False
            
        except Exception as e:
            logger.debug("Error checking self-container: %s", e)
            return False

    # -------------------------
    # Lifecycle
    # -------------------------
    async def start(self):
        """Start the LogStreamer (call from app startup)"""
        async with self._start_lock:
            if self._started:
                return
            try:
                # LogProcessor doesn't need explicit start, just mark as started
                self._started = True
                logger.info("LogStreamer started successfully")
            except Exception as e:
                logger.error("Failed to start LogStreamer: %s", e)
                # still mark started so repeated calls don't keep failing in a tight loop
                self._started = True
                raise

    # -------------------------
    # Docker detection (keep original semantics)
    # -------------------------
    def _get_docker_client(self):
        """Lazy check for docker CLI (short-circuit cached result for 30 seconds)"""
        now = datetime.now()
        if (self._docker_cli_available is not None and 
            self._docker_cli_check_time and 
            (now - self._docker_cli_check_time).total_seconds() < 30):
            return 'cli' if self._docker_cli_available else None

        try:
            import subprocess
            result = subprocess.run(
                ['docker', 'version', '--format', '{{.Client.Version}}'],
                capture_output=True,
                text=True,
                timeout=5
            )
            if result.returncode == 0 and result.stdout.strip():
                self._docker_cli_available = True
                self._docker_cli_check_time = now
                return 'cli'
        except Exception as e:
            logger.debug("Docker CLI probe failed: %s", e)

        self._docker_cli_available = False
        self._docker_cli_check_time = now
        return None

    # -------------------------
    # WebSocket management
    # -------------------------
    async def add_websocket(self, websocket: WebSocket, container_id: str = "all") -> None:
        """Register a client WebSocket subscription to a container (or 'all') with improved concurrent handling"""
        try:
            # Ensure processor started
            await self.start()

            async with self._ws_lock:
                # Initialize structures if they don't exist
                if container_id not in self.websockets:
                    self.websockets[container_id] = weakref.WeakSet()
                    self._rate_limits[container_id] = deque()
                
                # Add websocket to the container's subscriber set
                self.websockets[container_id].add(websocket)

                # Track which containers this websocket is subscribed to
                if websocket not in self.websocket_groups:
                    self.websocket_groups[websocket] = set()
                self.websocket_groups[websocket].add(container_id)

                # Initialize connection state and filters
                self._connection_health[websocket] = datetime.now().timestamp()
                self._connection_filters[websocket] = {
                    "level": None,
                    "search": None,
                    "service": None
                }

                # Initialize buffer for container
                if container_id not in self.log_buffer:
                    self.log_buffer[container_id] = deque(maxlen=self.max_logs_per_container)

                logger.info("WebSocket added for container=%s, total subscribers=%d", 
                           container_id, len(self.websockets[container_id]))

                # Start streaming for this container (will check if already active)
                if container_id != "all":
                    # Use create_task to avoid blocking
                    asyncio.create_task(self.start_streaming(container_id))

                # Send initial logs (fire-and-forget)
                if self.log_buffer.get(container_id):
                    asyncio.create_task(self._send_initial_logs(websocket, container_id))

        except Exception as e:
            logger.exception("Error adding websocket for %s: %s", container_id, e)
            raise

    async def remove_websocket(self, websocket: WebSocket, container_id: Optional[str] = None) -> None:
        """Remove websocket from container subscriptions and clean up if needed"""
        try:
            async with self._ws_lock:
                # Determine containers to remove this ws from
                containers_to_check = set()
                if container_id:
                    containers_to_check.add(container_id)
                if websocket in self.websocket_groups:
                    containers_to_check |= set(self.websocket_groups[websocket])
                    del self.websocket_groups[websocket]

                for cont in containers_to_check:
                    if cont in self.websockets:
                        try:
                            # WeakSet discard won't raise
                            self.websockets[cont].discard(websocket)
                        except Exception:
                            # Fallback: remove references manually
                            for ws in list(self.websockets[cont]):
                                if ws is websocket:
                                    self.websockets[cont].discard(ws)

                        # if no more subscribers, stop streaming
                        if not bool(self.websockets.get(cont)):
                            # cleanup
                            self.websockets.pop(cont, None)
                            self._rate_limits.pop(cont, None)
                            if cont in self.active_containers:
                                # schedule stop_streaming
                                asyncio.create_task(self.stop_streaming(cont))

                # cleanup connection metadata
                if websocket in self._connection_health:
                    del self._connection_health[websocket]
                if websocket in self._connection_filters:
                    del self._connection_filters[websocket]

                logger.info("WebSocket removed and cleaned up for %s containers", len(containers_to_check))
        except Exception as e:
            logger.exception("Error removing websocket: %s", e)
            raise

    async def _send_initial_logs(self, websocket: WebSocket, container_id: str):
        """Send initial buffered logs to the given websocket"""
        try:
            logs = list(self.log_buffer.get(container_id, []))
            if not logs:
                return

            batch_size = 50
            for i in range(0, len(logs), batch_size):
                batch = logs[i:i+batch_size]
                # Use send_json; exceptions will be handled by caller
                for item in batch:
                    try:
                        # Format message for frontend compatibility
                        formatted_message = {
                            "type": "log",
                            "payload": item,
                            "timestamp": item.get('timestamp', datetime.now().isoformat())
                        }
                        await websocket.send_json(formatted_message)
                    except Exception:
                        # If send_json fails, remove websocket
                        await self.remove_websocket(websocket, container_id)
                        return
                if i + batch_size < len(logs):
                    await asyncio.sleep(0.01)
        except Exception as e:
            logger.exception("Error sending initial logs: %s", e)
            try:
                await self.remove_websocket(websocket, container_id)
            except Exception:
                pass

    # -------------------------
    # Starting / Stopping streaming for a container (uses LogProcessor)
    # -------------------------
    async def start_streaming(self, container_id: str):
        """Start streaming for a container - supports multiple concurrent WebSocket connections"""
        # Allow self-monitoring for debugging purposes but with rate limiting
        if await self._is_self_container(container_id):
            logger.info("Self-monitoring detected for container %s - proceeding with caution", container_id)
            
        # Check if streaming is already active for this container
        if container_id in self.active_tasks and not self.active_tasks[container_id].done():
            logger.debug("Streaming already active for %s - reusing existing stream", container_id)
            return

        # Only start streaming if there are active WebSocket subscribers
        async with self._ws_lock:
            if container_id not in self.websockets or not bool(self.websockets[container_id]):
                logger.debug("No WebSocket subscribers for %s, skipping stream start", container_id)
                return
            subscriber_count = len(self.websockets[container_id])

        self.active_containers.add(container_id)

        # Cancel previous task if present (cleanup)
        prev = self.active_tasks.pop(container_id, None)
        if prev and not prev.done():
            prev.cancel()
            try:
                await asyncio.wait_for(prev, timeout=2.0)
            except (asyncio.CancelledError, asyncio.TimeoutError):
                pass

        # Create a new streaming task
        task = asyncio.create_task(self._stream_via_processor(container_id))
        self.active_tasks[container_id] = task
        logger.info("Started streaming for container %s (subscribers: %d)", container_id, subscriber_count)

    async def stop_streaming(self, container_id: str):
        """Stop streaming for a container - only if no more WebSocket subscribers"""
        try:
            # Check if there are still active subscribers before stopping
            async with self._ws_lock:
                if container_id in self.websockets and bool(self.websockets[container_id]):
                    logger.debug("Not stopping stream for %s - still has %d subscribers", 
                               container_id, len(self.websockets[container_id]))
                    return

            # Stop the streaming task
            task = self.active_tasks.pop(container_id, None)
            if task and not task.done():
                task.cancel()
                try:
                    await asyncio.wait_for(task, timeout=3.0)
                except (asyncio.CancelledError, asyncio.TimeoutError):
                    pass

            # Cancel batch task
            batch_task = self._batch_tasks.pop(container_id, None)
            if batch_task and not batch_task.done():
                batch_task.cancel()
                try:
                    await asyncio.wait_for(batch_task, timeout=1.0)
                except (asyncio.CancelledError, asyncio.TimeoutError):
                    pass

            # Cleanup containers
            self.active_containers.discard(container_id)
            self._batch_queue.pop(container_id, None)
            # Keep log_buffer for future connections
            logger.info("Stopped streaming for container %s (no more subscribers)", container_id)
        except Exception as e:
            logger.exception("Error stopping stream for %s: %s", container_id, e)
            # Ensure no dangling state
            self.active_containers.discard(container_id)
            self.active_tasks.pop(container_id, None)
            self._batch_tasks.pop(container_id, None)
            self._batch_queue.pop(container_id, None)
            raise

    async def _stream_via_processor(self, container_id: str):
        """Stream logs from a container using Docker service with real-time streaming."""
        try:
            # ensure processor started
            await self.start()

            # ensure buffer exists
            if container_id not in self.log_buffer:
                self.log_buffer[container_id] = deque(maxlen=self.max_logs_per_container)

            logger.info(f"Starting real-time log streaming for container: {container_id}")
            
            # Start streaming logs with follow=True for real-time streaming
            try:
                docker_service = get_docker_service()
                
                # Get recent logs for context (last 10 lines to avoid overwhelming)
                recent_logs = await docker_service.get_container_logs(
                    container_id=container_id,
                    tail=10,
                    timestamps=True
                )
                
                # Process recent logs and send them immediately
                for log_dict in recent_logs:
                    log_entry = {
                        'container_id': container_id,
                        'timestamp': log_dict.get('timestamp', datetime.now().isoformat()),
                        'message': log_dict.get('message', ''),
                        'level': log_dict.get('level', 'info').lower(),
                        'raw': log_dict.get('message', '')
                    }
                    
                    # Add to buffer
                    self.log_buffer[container_id].append(log_entry)
                    
                    # Send to WebSocket clients immediately
                    await self._send_to_websockets(container_id, [log_entry])
                
                logger.info(f"Sent {len(recent_logs)} recent logs for {container_id}")
                
                # Start real-time streaming with follow=True and tail=0 for only new logs
                log_generator = docker_service.stream_container_logs(
                    container_id=container_id,
                    follow=True,      # Stream new logs in real-time
                    tail=0,           # Only new logs, no historical
                    timestamps=True
                )
                
                logger.info(f"Started real-time log streaming for container: {container_id}")
                
                log_count = 0
                async for log_line in log_generator:
                    if not self._started:
                        logger.info(f"LogStreamer stopped, breaking log stream for {container_id}")
                        break
                        
                    # Skip empty lines
                    if not log_line or not log_line.strip():
                        continue
                        
                    log_count += 1
                    if log_count % 100 == 1:  # Log every 100th message to reduce spam
                        logger.debug(f"Processing real-time log #{log_count} from {container_id}")
                        
                    # Process log line - create structured log entry
                    log_entry = {
                        'container_id': container_id,
                        'timestamp': datetime.now().isoformat(),
                        'message': log_line.strip(),
                        'level': 'info',
                        'raw': log_line.strip()
                    }
                    
                    # Extract timestamp if present in log line (Docker format: 2025-09-06T03:10:58.890010636Z MESSAGE)
                    timestamp_match = re.match(r'^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z?)\s+(.+)', log_line)
                    if timestamp_match:
                        log_entry['timestamp'] = timestamp_match.group(1)
                        log_entry['message'] = timestamp_match.group(2).strip()
                        log_entry['raw'] = log_line.strip()
                    
                    # Extract log level if present
                    level_match = re.search(r'\b(DEBUG|INFO|WARN|WARNING|ERROR|FATAL|TRACE)\b', log_entry['message'], re.IGNORECASE)
                    if level_match:
                        log_entry['level'] = level_match.group(1).lower()
                    
                    # Add to buffer for caching
                    self.log_buffer[container_id].append(log_entry)
                    
                    # Send immediately to WebSocket clients - this is the key fix
                    await self._send_to_websockets(container_id, [log_entry])
                        
            except Exception as e:
                logger.error(f"Error streaming logs for {container_id}: {e}")
                # Don't re-raise, let the restart logic handle it
                
        except Exception as e:
            logger.error(f"Unexpected error in _stream_via_processor for {container_id}: {e}")
        finally:
            # Clean up
            self.active_containers.discard(container_id)
            if container_id in self.active_tasks:
                del self.active_tasks[container_id]
            if container_id in self._batch_tasks:
                task = self._batch_tasks.pop(container_id, None)
                if task and not task.done():
                    task.cancel()
            logger.info("Cleaned up stream for %s", container_id)

            # Only restart if there are still active subscribers and the stream wasn't manually stopped
            async with self._ws_lock:
                if (container_id in self.websockets and 
                    bool(self.websockets[container_id])):
                    logger.info("Restarting stream for %s due to %d active subscribers", 
                               container_id, len(self.websockets[container_id]))
                    await asyncio.sleep(2)  # Brief delay before restart
                    asyncio.create_task(self.start_streaming(container_id))
                else:
                    logger.info("No restart needed for %s - no active subscribers", container_id)

    async def _send_to_websockets(self, container_id: str, log_entries: List[Dict[str, Any]]):
        """Send log entries directly to WebSocket clients with improved real-time delivery"""
        try:
            if not log_entries:
                return
                
            # Build the target set (subscribers to container_id and to 'all')
            targets = set()
            async with self._ws_lock:
                if container_id in self.websockets:
                    targets.update(list(self.websockets[container_id]))
                if 'all' in self.websockets:
                    targets.update(list(self.websockets['all']))

            if not targets:
                logger.debug(f"No WebSocket targets for container {container_id}")
                return

            # Filter out disconnected websockets and send messages
            disconnected = []
            for log_entry in log_entries:
                # broadcast individually to preserve filtering per client
                for ws in list(targets):
                    if ws is None:
                        continue
                    try:
                        # Check WebSocket state more thoroughly
                        if hasattr(ws, 'client_state'):
                            if ws.client_state != WebSocketState.CONNECTED:
                                disconnected.append(ws)
                                continue
                        
                        # Apply filters
                        filters = self._connection_filters.get(ws, {})
                        if not self._should_send_log(log_entry, filters):
                            continue
                            
                        # Format message for frontend compatibility - ensure all required fields
                        formatted_message = {
                            "type": "log",
                            "payload": {
                                "container_id": log_entry.get('container_id') or container_id,
                                "containerId": log_entry.get('container_id') or container_id,  # Add both formats
                                "timestamp": log_entry.get('timestamp', datetime.now().isoformat()),
                                "message": log_entry.get('message', ''),
                                "level": log_entry.get('level', 'info'),
                                "raw": log_entry.get('raw', log_entry.get('message', '')),
                                "container": log_entry.get('container_id') or container_id
                            },
                            "timestamp": datetime.now().isoformat()
                        }
                        
                        # Send immediately without batching for real-time delivery
                        await ws.send_json(formatted_message)
                        
                        # update last activity
                        self._connection_health[ws] = datetime.now().timestamp()
                        
                        logger.debug(f"Sent real-time log to WebSocket for container {container_id}: {log_entry['message'][:50]}...")
                        
                    except Exception as e:
                        logger.debug(f"Error sending to websocket: {e}")
                        disconnected.append(ws)

            # cleanup disconnected websockets
            if disconnected:
                for ws in set(disconnected):
                    try:
                        await self.remove_websocket(ws, container_id)
                    except Exception:
                        logger.debug("Error cleaning up disconnected websocket", exc_info=True)
                        
        except Exception as e:
            logger.error(f"Error sending logs to websockets for {container_id}: {e}")

    # -------------------------
    # Processor callback — receives structured log dicts from LogProcessor
    # -------------------------
    async def _on_processed_log(self, processed: Dict[str, Any]) -> None:
        """
        Called by LogProcessor._dispatch_processed for each processed log object.
        We normalize and route it into buffers / batch queues.
        """
        try:
            # processed is expected to be a dict from LogProcessor with keys like:
            # 'container' (name or id), 'message', 'level', 'timestamp', 'service', etc.
            container_key = processed.get('container_id') or processed.get('container') or processed.get('container_name') or 'all'

            # Normalize container id key — prefer the container id string passed in start_streaming
            # If container_key is full name, that's fine; we allow subscribers to subscribe to names or ids.
            # Ensure structures exist
            if container_key not in self.log_buffer:
                self.log_buffer[container_key] = deque(maxlen=self.max_logs_per_container)
            if container_key not in self._batch_queue:
                self._batch_queue[container_key] = []
            if container_key not in self._rate_limits:
                self._rate_limits[container_key] = deque()

            # Add metadata
            processed.setdefault('received_at', datetime.now().isoformat())

            # Append to buffer & batch queue
            self.log_buffer[container_key].append(processed)
            self._batch_queue[container_key].append(processed)

            # Ensure batch processor task exists
            if container_key not in self._batch_tasks or self._batch_tasks[container_key].done():
                self._batch_tasks[container_key] = asyncio.create_task(self._batch_processor(container_key))

        except Exception as e:
            logger.exception("Error in _on_processed_log: %s (log=%s)", e, processed if isinstance(processed, dict) else str(processed))

    # -------------------------
    # Batch processing and broadcasting
    # -------------------------
    async def _batch_processor(self, container_id: str):
        """Take batches off _batch_queue and broadcast to subscribers"""
        try:
            while True:
                await asyncio.sleep(self._batch_timeout)
                if container_id not in self._batch_queue or not self._batch_queue[container_id]:
                    continue

                batch = self._batch_queue[container_id][:self._batch_size]
                self._batch_queue[container_id] = self._batch_queue[container_id][len(batch):]

                # Build the target set (subscribers to container_id and to 'all')
                targets = set()
                async with self._ws_lock:
                    if container_id in self.websockets:
                        targets.update(list(self.websockets[container_id]))
                    if 'all' in self.websockets:
                        targets.update(list(self.websockets['all']))

                # Filter out disconnected websockets and apply rate-limits
                current_ts = datetime.now().timestamp()
                if container_id not in self._rate_limits:
                    self._rate_limits[container_id] = deque()

                # prune old timestamps
                try:
                    while self._rate_limits[container_id] and current_ts - self._rate_limits[container_id][0] > self.rate_limit_interval:
                        self._rate_limits[container_id].popleft()
                except Exception:
                    pass

                # rate limit check
                if len(self._rate_limits[container_id]) >= self.rate_limit_max_messages:
                    logger.warning("Dropping batch due to rate limit for %s", container_id)
                    continue
                self._rate_limits[container_id].append(current_ts)

                disconnected = []
                for log_entry in batch:
                    # broadcast individually to preserve filtering per client
                    for ws in list(targets):
                        if ws is None:
                            continue
                        try:
                            # ensure connected
                            if getattr(ws, "client_state", None) is not None:
                                if ws.client_state != WebSocketState.CONNECTED:
                                    disconnected.append(ws)
                                    continue
                            # filter
                            filters = self._connection_filters.get(ws, {})
                            if not self._should_send_log(log_entry, filters):
                                continue
                            try:
                                # Format message for frontend compatibility
                                formatted_message = {
                                    "type": "log",
                                    "payload": {
                                        "container_id": log_entry.get('container_id') or log_entry.get('container') or container_id,
                                        "timestamp": log_entry.get('timestamp', datetime.now().isoformat()),
                                        "message": log_entry.get('message', ''),
                                        "level": log_entry.get('level', 'info'),
                                        "raw": log_entry.get('raw', log_entry.get('message', ''))
                                    }
                                }
                                await ws.send_json(formatted_message)
                                # update last activity
                                self._connection_health[ws] = datetime.now().timestamp()
                            except Exception:
                                disconnected.append(ws)
                        except Exception as e:
                            logger.exception("Error broadcasting to websocket: %s", e)
                            disconnected.append(ws)

                # cleanup disconnected websockets
                if disconnected:
                    for ws in set(disconnected):
                        try:
                            await self.remove_websocket(ws, container_id)
                        except Exception:
                            logger.debug("Error cleaning up disconnected websocket", exc_info=True)

                # Check if no more subscribers and cleanup
                async with self._ws_lock:
                    if container_id in self.websockets and not bool(self.websockets[container_id]):
                        logger.info("No more subscribers for %s, scheduling cleanup", container_id)
                        self.websockets.pop(container_id, None)
                        self._rate_limits.pop(container_id, None)
                        # Schedule stop_streaming as a background task
                        asyncio.create_task(self.stop_streaming(container_id))

        except asyncio.CancelledError:
            logger.debug("Batch processor cancelled for %s", container_id)
        except Exception as e:
            logger.exception("Error in batch processor for %s: %s", container_id, e)

    # -------------------------
    # Filtering logic
    # -------------------------
    def _should_send_log(self, log_entry: Dict[str, Any], filters: Optional[Dict]) -> bool:
        if not filters:
            return True

        # Level filter
        if filters.get('level'):
            log_level = (log_entry.get('level') or "").lower()
            if log_level not in filters['level']:
                return False

        # Search filter
        if filters.get('search'):
            search = filters['search'].lower()
            message = (log_entry.get('message') or "").lower()
            if search not in message:
                return False

        # Service filter
        if filters.get('service'):
            service = (log_entry.get('service') or "").lower()
            if service not in filters['service']:
                return False

        return True

    # -------------------------
    # Health check (called periodically by main)
    # -------------------------
    async def check_websocket_health(self):
        """Check websocket health using client_state and remove disconnected ones"""
        try:
            current_ts = datetime.now().timestamp()
            async with self._ws_lock:
                for container_id, ws_set in list(self.websockets.items()):
                    for ws in list(ws_set):
                        try:
                            if getattr(ws, "client_state", None) is not None:
                                if ws.client_state != WebSocketState.CONNECTED:
                                    await self.remove_websocket(ws, container_id)
                                    continue
                            # timeout-based cleanup (inactive for >5 minutes)
                            last = self._connection_health.get(ws, current_ts)
                            if current_ts - last > 300:
                                await self.remove_websocket(ws, container_id)
                        except Exception:
                            # aggressively remove on any unexpected error
                            await self.remove_websocket(ws, container_id)
        except Exception as e:
            logger.exception("Error during websocket health check: %s", e)

    # -------------------------
    # Stop all streams - already present but left as-is (works with new start)
    # -------------------------
    async def stop_all(self):
        """Stop all log streaming tasks with proper cleanup"""
        logger.info("Stopping all log streaming tasks...")
        tasks_to_cancel = list(self.active_tasks.values())
        batch_tasks_to_cancel = list(self._batch_tasks.values())

        for t in tasks_to_cancel + batch_tasks_to_cancel:
            if not t.done():
                t.cancel()

        if tasks_to_cancel or batch_tasks_to_cancel:
            await asyncio.gather(*tasks_to_cancel, *batch_tasks_to_cancel, return_exceptions=True)

        self.active_tasks.clear()
        self.active_containers.clear()
        self.websockets.clear()
        self.log_buffer.clear()
        self._batch_queue.clear()
        self._batch_tasks.clear()

        # stop processor if it has a stop API
        try:
            if hasattr(self.processor, "stop"):
                maybe = getattr(self.processor, "stop")
                res = maybe()
                if asyncio.iscoroutine(res):
                    await res
        except Exception as e:
            logger.debug("Processor stop call failed: %s", e)

        logger.info("All log streaming tasks stopped")

# Global singleton accessor
_log_streamer: Optional[LogStreamer] = None

def get_log_streamer() -> LogStreamer:
    global _log_streamer
    if _log_streamer is None:
        _log_streamer = LogStreamer()
    return _log_streamer

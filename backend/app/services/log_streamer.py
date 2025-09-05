import asyncio
import json
import logging
from typing import Dict, List, Optional, Set, Any
from fastapi import WebSocket
from .docker import get_docker_service
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
        # Processor (do NOT start here — call start() in async context)
        self.processor = LogProcessor()

        # Task management
        self.active_tasks: Dict[str, asyncio.Task] = {}
        self.active_containers: Set[str] = set()

        # WebSocket management using weak references (auto cleanup on GC)
        self.websockets: Dict[str, weakref.WeakSet] = {}  # container_id -> WeakSet[WebSocket]
        self.websocket_groups: weakref.WeakKeyDictionary = weakref.WeakKeyDictionary()  # WebSocket -> set(container_id)
        self._ws_lock = asyncio.Lock()

        # Buffering & batching
        self.max_logs_per_container = 1000
        self.log_buffer: Dict[str, deque] = {}
        self._batch_queue: Dict[str, List[Dict[str, Any]]] = {}
        self._batch_size = 10
        self._batch_timeout = 0.1
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

        # Internal started flag
        self._started = False
        self._start_lock = asyncio.Lock()

    # -------------------------
    # Lifecycle
    # -------------------------
    async def start(self):
        """Start the underlying LogProcessor (call from app startup)"""
        async with self._start_lock:
            if self._started:
                return
            try:
                await self.processor.start()
                # Pre-check docker CLI availability
                self._docker_cli_available = self._get_docker_client() is not None
                self._started = True
                logger.info("LogStreamer started (processor running). Docker CLI available=%s", self._docker_cli_available)
            except Exception as e:
                logger.exception("Failed to start LogProcessor: %s", e)
                # still mark started so repeated calls don't keep failing in a tight loop
                self._started = True

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
        """Register a client WebSocket subscription to a container (or 'all')"""
        try:
            # Ensure processor started
            await self.start()

            async with self._ws_lock:
                if container_id not in self.websockets:
                    self.websockets[container_id] = weakref.WeakSet()
                    self._rate_limits[container_id] = deque()
                self.websockets[container_id].add(websocket)

                if websocket not in self.websocket_groups:
                    self.websocket_groups[websocket] = set()
                self.websocket_groups[websocket].add(container_id)

                # initialize connection state and filters
                self._connection_health[websocket] = datetime.now().timestamp()
                self._connection_filters[websocket] = {
                    "level": None,
                    "search": None,
                    "service": None
                }

                # initialize buffer for container
                if container_id not in self.log_buffer:
                    self.log_buffer[container_id] = deque(maxlen=self.max_logs_per_container)

                # Start streaming for container when appropriate
                if container_id != "all" and container_id not in self.active_containers:
                    await self.start_streaming(container_id)

                # send initial logs (fire-and-forget)
                if self.log_buffer.get(container_id):
                    asyncio.create_task(self._send_initial_logs(websocket, container_id))

                logger.info("WebSocket added for container=%s, total=%d", container_id, len(self.websockets[container_id]))
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
                        await websocket.send_json(item)
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
        """Start streaming for a container (runs initial tail then follow via LogProcessor)"""
        if container_id in self.active_tasks and not self.active_tasks[container_id].done():
            logger.debug("Streaming already active for %s", container_id)
            return

        self.active_containers.add(container_id)

        # cancel previous task if present
        prev = self.active_tasks.pop(container_id, None)
        if prev and not prev.done():
            prev.cancel()

        # create a task that runs initial tail + follow stream
        task = asyncio.create_task(self._stream_via_processor(container_id))
        self.active_tasks[container_id] = task
        logger.info("Start requested for streaming container %s", container_id)

    async def stop_streaming(self, container_id: str):
        """Stop streaming for a container"""
        try:
            task = self.active_tasks.pop(container_id, None)
            if task and not task.done():
                task.cancel()
                try:
                    await asyncio.wait_for(task, timeout=3.0)
                except (asyncio.CancelledError, asyncio.TimeoutError):
                    pass

            # cancel batch task
            batch_task = self._batch_tasks.pop(container_id, None)
            if batch_task and not batch_task.done():
                batch_task.cancel()
                try:
                    await asyncio.wait_for(batch_task, timeout=1.0)
                except (asyncio.CancelledError, asyncio.TimeoutError):
                    pass

            # cleanup containers
            self.active_containers.discard(container_id)
            self._batch_queue.pop(container_id, None)
            # don't clear log_buffer here (keep cached logs until memory pressure)
            logger.info("Stopped streaming for container %s", container_id)
        except Exception as e:
            logger.exception("Error stopping stream for %s: %s", container_id, e)
            # ensure no dangling state
            self.active_containers.discard(container_id)
            self.active_tasks.pop(container_id, None)
            self._batch_tasks.pop(container_id, None)
            self._batch_queue.pop(container_id, None)
            raise

    async def _stream_via_processor(self, container_id: str):
        """Stream logs from a container using Docker service."""
        try:
            # ensure processor started
            await self.start()

            # ensure buffer exists
            if container_id not in self.log_buffer:
                self.log_buffer[container_id] = deque(maxlen=self.max_logs_per_container)

            # Get Docker service
            docker_service = get_docker_service()
            
            # 1) Get initial logs
            tail_count = 50
            initial_logs = await docker_service.get_container_logs(
                container_id,
                tail=tail_count,
                timestamps=True
            )
            
            # Process initial logs
            for log in initial_logs:
                await self._on_processed_log(log)

            # 2) Stream logs in real-time
            try:
                # Get the Docker client
                client = docker_service.client
                if not client:
                    raise Exception("Docker client not available")
                
                # Start streaming logs
                container = client.containers.get(container_id)
                for line in container.logs(stream=True, follow=True, timestamps=True, tail=0):
                    if container_id not in self.active_containers:
                        break
                        
                    # Process the log line
                    log_entry = {
                        'container_id': container_id,
                        'timestamp': datetime.now(timezone.utc).isoformat(),
                        'message': line.decode('utf-8').strip()
                    }
                    await self._on_processed_log(log_entry)
                    
                    # Small sleep to prevent high CPU usage
                    await asyncio.sleep(0.01)
            except Exception as e:
                logger.exception("Error streaming logs for %s: %s", container_id, e)
                # Backoff before returning to avoid tight restart loops
                await asyncio.sleep(1.0)
        finally:
            # cleanup: ensure our state is consistent
            self.active_tasks.pop(container_id, None)
            self.active_containers.discard(container_id)
            # cancel batch task if present
            bt = self._batch_tasks.pop(container_id, None)
            if bt and not bt.done():
                bt.cancel()
            logger.info("Cleaned up stream for %s", container_id)

            # if there are still subscribers, try restart after short delay
            if container_id in self.websockets and bool(self.websockets[container_id]):
                logger.info("Restarting stream for %s because subscribers still exist", container_id)
                await asyncio.sleep(1.0)
                await self.start_streaming(container_id)

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
            container_key = processed.get('container') or processed.get('container_name') or 'all'

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
                                await ws.send_json(log_entry)
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

                # if no more subscribers, cleanup and stop streaming
                async with self._ws_lock:
                    if container_id in self.websockets and not bool(self.websockets[container_id]):
                        logger.info("No more subscribers for %s, stopping stream", container_id)
                        self.websockets.pop(container_id, None)
                        self._rate_limits.pop(container_id, None)
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

import asyncio
import time
import logging
import weakref
from typing import Dict, Set, Optional, Any
from fastapi import WebSocket
from starlette.websockets import WebSocketState

logger = logging.getLogger(__name__)

PING_PAYLOAD = {"type": "ping"}

class ConnectionManager:
    """
    Optimized connection manager:
    - WeakSets for container subscribers (auto cleanup when WebSocket objects are GC'd)
    - WeakKeyDictionary for per-WebSocket metadata
    - Single background pinger + cleanup task instead of per-connection keepalive tasks
    - Concurrent, bounded broadcasts (with per-send timeout)
    """

    def __init__(
        self,
        *,
        max_connections_per_container: int = 50,
        stale_timeout: float = 300.0,         # seconds without activity -> stale
        ping_interval: float = 30.0,          # seconds between pings
        cleanup_interval: float = 60.0,       # seconds between periodic cleanup runs
        send_timeout: float = 3.0,            # seconds allowed per websocket send
        send_concurrency: int = 50            # max concurrent send tasks during broadcast
    ):
        # container_id -> WeakSet[WebSocket]
        self.active_connections: Dict[str, weakref.WeakSet] = {}

        # websocket -> set(container_id)
        self.connection_containers: "weakref.WeakKeyDictionary[WebSocket, set]" = weakref.WeakKeyDictionary()

        # last activity timestamp per websocket (weak keys)
        self.last_activity: "weakref.WeakKeyDictionary[WebSocket, float]" = weakref.WeakKeyDictionary()

        self.lock = asyncio.Lock()

        # Configuration
        self.max_connections_per_container = max_connections_per_container
        self.stale_timeout = stale_timeout
        self.ping_interval = ping_interval
        self.cleanup_interval = cleanup_interval
        self.send_timeout = send_timeout
        self.send_concurrency = send_concurrency

        # Background tasks
        self._maintenance_task: Optional[asyncio.Task] = None
        self._running = False

        # Semaphore used to bound concurrent sends during broadcast
        self._send_semaphore = asyncio.Semaphore(self.send_concurrency)

    # -------------------------
    # Lifecycle (start/stop maintenance task)
    # -------------------------
    async def start(self):
        """Start the background maintenance task (idempotent). Call at app startup."""
        if self._running:
            return
        self._running = True
        loop = asyncio.get_running_loop()
        self._maintenance_task = loop.create_task(self._maintenance_loop())
        logger.debug("ConnectionManager maintenance task started")

    async def shutdown(self):
        """Stop maintenance and attempt graceful cleanup of remaining connections."""
        self._running = False
        if self._maintenance_task:
            self._maintenance_task.cancel()
            try:
                await self._maintenance_task
            except asyncio.CancelledError:
                pass
            self._maintenance_task = None
        # attempt to disconnect all remaining websockets
        async with self.lock:
            websockets = [ws for s in self.active_connections.values() for ws in list(s)]
        for ws in websockets:
            try:
                await self.disconnect(ws)
            except Exception:
                logger.debug("Error during shutdown disconnect", exc_info=True)

    # -------------------------
    # Connect / Disconnect
    # -------------------------
    async def connect(self, websocket: WebSocket, container_id: str) -> int:
        """
        Accepts websocket and subscribes it to container_id.
        Returns current number of subscribers for that container after connect.
        """
        # Check if websocket is already accepted
        try:
            if hasattr(websocket, 'client_state') and websocket.client_state.name != 'CONNECTED':
                await websocket.accept()
        except Exception as e:
            logger.warning(f"WebSocket accept failed, but continuing: {e}")
            # Continue anyway to prevent connection rejection

        async with self.lock:
            if container_id not in self.active_connections:
                self.active_connections[container_id] = weakref.WeakSet()

            # Support unlimited concurrent connections for scalability
            current_count = len(self.active_connections[container_id])
            logger.info(f"Accepting WebSocket connection for container {container_id}, current count: {current_count}")
            # No connection limit - support parallel multiple connections

            # register websocket
            self.active_connections[container_id].add(websocket)

            if websocket not in self.connection_containers:
                self.connection_containers[websocket] = set()
            self.connection_containers[websocket].add(container_id)

            # set last activity now
            self.last_activity[websocket] = time.time()

            # start maintenance task lazily
            if not self._running:
                # fire-and-forget start (safe to call repeatedly)
                asyncio.create_task(self.start())

            logger.info("Connected websocket for container=%s now total=%d", container_id, len(self.active_connections[container_id]))
            return len(self.active_connections[container_id])

    async def disconnect(self, websocket: WebSocket):
        """Remove websocket from all containers and close it if necessary."""
        async with self.lock:
            containers = set(self.connection_containers.get(websocket, set()))
            # Remove from all container sets
            for container in containers:
                if container in self.active_connections:
                    try:
                        self.active_connections[container].discard(websocket)
                    except Exception:
                        # ignore; weakset robustness handles many cases
                        pass
                    if not bool(self.active_connections[container]):
                        # remove empty container entry
                        del self.active_connections[container]

            # remove per-websocket records
            if websocket in self.connection_containers:
                del self.connection_containers[websocket]
            if websocket in self.last_activity:
                del self.last_activity[websocket]

        # attempt to close websocket connection gracefully (best-effort)
        try:
            if getattr(websocket, "client_state", None) is not None:
                if websocket.client_state == WebSocketState.CONNECTED:
                    await websocket.close()
        except Exception:
            # ignore errors during close
            logger.debug("Exception while closing websocket", exc_info=True)

        logger.info("Disconnected websocket from containers=%s", containers)

    # -------------------------
    # Broadcast
    # -------------------------
    async def broadcast(self, container_id: str, message: Any):
        """
        Broadcast message concurrently to all subscribers for container_id and 'all'.
        Bounded concurrency and per-send timeout prevents a single slow client from blocking.
        """
        async with self.lock:
            targets = set()
            if container_id in self.active_connections:
                targets.update(list(self.active_connections[container_id]))
            if "all" in self.active_connections:
                targets.update(list(self.active_connections["all"]))

        if not targets:
            return

        # prune None / dead objects
        targets = {ws for ws in targets if ws is not None}

        async def _safe_send(ws: WebSocket, payload: Any):
            # use semaphore to bound concurrency
            async with self._send_semaphore:
                try:
                    # quickly skip disconnected sockets
                    if getattr(ws, "client_state", None) is not None and ws.client_state != WebSocketState.CONNECTED:
                        raise RuntimeError("WebSocket not connected")
                    # perform send with timeout
                    coro = ws.send_json(payload)
                    await asyncio.wait_for(coro, timeout=self.send_timeout)
                    # update activity timestamp on success
                    self.last_activity[ws] = time.time()
                    return True
                except Exception as e:
                    logger.debug("Send failed to websocket: %s", e)
                    return False

        # Fire all sends concurrently and gather results
        send_tasks = [asyncio.create_task(_safe_send(ws, message)) for ws in targets]
        if not send_tasks:
            return

        results = await asyncio.gather(*send_tasks, return_exceptions=True)

        # Clean up failed connections
        failed = []
        for ws, res in zip(list(targets), results):
            ok = isinstance(res, bool) and res is True
            if not ok:
                failed.append(ws)

        if failed:
            for ws in failed:
                try:
                    await self.disconnect(ws)
                except Exception:
                    logger.debug("Error cleaning up failed ws", exc_info=True)

    # -------------------------
    # Activity & Stats
    # -------------------------
    def update_activity(self, websocket: WebSocket):
        """Update last activity timestamp for a connection"""
        try:
            self.last_activity[websocket] = time.time()
        except Exception:
            # WeakKeyDict may raise if ws is not weakref-able; ignore
            logger.debug("Could not update activity for websocket", exc_info=True)

    async def get_stats(self) -> Dict[str, Any]:
        """Return summary stats (fast, non-blocking)"""
        async with self.lock:
            total = sum(len(s) for s in self.active_connections.values())
            containers = {cid: len(s) for cid, s in self.active_connections.items()}
        return {"total_connections": total, "containers": containers}

    # -------------------------
    # Maintenance loop: pings + stale cleanup
    # -------------------------
    async def _maintenance_loop(self):
        """Background task that sends pings and removes stale/disconnected websockets"""
        try:
            while self._running:
                start = time.time()
                # 1) Send ping to active websockets (best-effort)
                async with self.lock:
                    # snapshot targets to avoid holding lock during network IO
                    targets = {ws for s in self.active_connections.values() for ws in list(s)}
                if targets:
                    ping_tasks = []
                    for ws in targets:
                        # skip non-connected quickly
                        if getattr(ws, "client_state", None) is not None and ws.client_state != WebSocketState.CONNECTED:
                            ping_tasks.append(asyncio.create_task(self.disconnect(ws)))
                            continue
                        # send ping with same bounded concurrency mechanism
                        ping_tasks.append(asyncio.create_task(self._ping_one(ws)))
                    if ping_tasks:
                        # wait but don't let maintenance block forever
                        await asyncio.gather(*ping_tasks, return_exceptions=True)

                # 2) Remove stale websockets by last_activity
                now_ts = time.time()
                stale = []
                async with self.lock:
                    for ws, last in list(self.last_activity.items()):
                        if now_ts - last > self.stale_timeout:
                            stale.append(ws)

                for ws in stale:
                    try:
                        await self.disconnect(ws)
                    except Exception:
                        logger.debug("Error during stale disconnect", exc_info=True)

                # Sleep until next maintenance tick (respect time spent)
                elapsed = time.time() - start
                wait_for = max(0.0, self.cleanup_interval - elapsed)
                await asyncio.sleep(wait_for)
        except asyncio.CancelledError:
            logger.debug("Maintenance loop cancelled")
        except Exception:
            logger.exception("Unexpected error in maintenance loop")
        finally:
            self._running = False

    async def _ping_one(self, websocket: WebSocket):
        """Ping single websocket (best-effort). Uses send_json ping to be generic across clients."""
        try:
            # quick check to avoid raising if socket disconnected
            if getattr(websocket, "client_state", None) is not None and websocket.client_state != WebSocketState.CONNECTED:
                await self.disconnect(websocket)
                return
            await asyncio.wait_for(websocket.send_json(PING_PAYLOAD), timeout=min(3.0, self.send_timeout))
            # on success, update last activity
            self.last_activity[websocket] = time.time()
        except Exception:
            # Treat any failure as disconnect signal
            try:
                await self.disconnect(websocket)
            except Exception:
                logger.debug("Error closing websocket after failed ping", exc_info=True)

# Create a singleton instance of the connection manager
manager = ConnectionManager()

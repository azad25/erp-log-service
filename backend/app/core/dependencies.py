"""
Dependency injection for FastAPI endpoints.
Provides singleton instances of services.
"""
import logging
from typing import Optional

from ..services.log_processor import LogProcessor
from ..services.log_streamer import LogStreamer, get_log_streamer
from ..services.docker import DockerService, get_docker_service

logger = logging.getLogger(__name__)

# Global instances
_log_processor: Optional[LogProcessor] = None
_docker_service: Optional[DockerService] = None


def get_log_processor() -> LogProcessor:
    """Get or create LogProcessor singleton instance."""
    global _log_processor
    if _log_processor is None:
        _log_processor = LogProcessor()
    return _log_processor


def get_docker_service() -> DockerService:
    """Get or create DockerService singleton instance."""
    global _docker_service
    if _docker_service is None:
        from ..services.docker import DockerService
        _docker_service = DockerService()
    return _docker_service


def get_log_streamer() -> LogStreamer:
    """Get or create LogStreamer singleton instance."""
    from ..services.log_streamer import get_log_streamer as _get_log_streamer
    return _get_log_streamer()

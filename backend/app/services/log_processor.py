import re
import json
import logging
from datetime import datetime
from typing import Dict, Optional, List, Any, Union
import docker
from app.core.config import settings

logger = logging.getLogger(__name__)

class LogProcessor:
    """Process and format Docker logs from various services"""
    
    def __init__(self):
        self.client = docker.DockerClient(base_url=settings.DOCKER_SOCKET)
        self.log_patterns = {
            'timestamp': {
                'iso8601': r'\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?',
                'postgres': r'\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)? [A-Z]+',
                'redis': r'\d{1,2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2}\.\d+',
                'qdrant': r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z',
            },
            'level': {
                'standard': r'(INFO|WARNING|ERROR|DEBUG|CRITICAL|WARN|FATAL)',
                'postgres': r'(LOG|ERROR|FATAL|PANIC|WARNING|NOTICE|DEBUG|INFO|HINT|DETAIL|CONTEXT|STATEMENT)',
                'redis': r'([A-Z]):'
            },
            'container': r'[a-zA-Z0-9][a-zA-Z0-9_.-]+',
            'message': r'.*'
        }
        self.container_patterns = {
            'elasticsearch': self._process_elasticsearch_log,
            'kibana': self._process_standard_log,
            'kafka': self._process_kafka_log,
            'mongodb': self._process_mongodb_log,
            'postgres': self._process_postgres_log,
            'redis': self._process_redis_log,
            'qdrant': self._process_qdrant_log,
            'default': self._process_standard_log
        }
    
    async def get_containers(self) -> List[Dict[str, Any]]:
        """Get list of all running containers"""
        try:
            containers = []
            for container in self.client.containers.list():
                container_info = {
                    'id': container.short_id,
                    'name': container.name,
                    'image': container.image.tags[0] if container.image.tags else '',
                    'status': container.status,
                    'labels': container.labels or {}
                }
                containers.append(container_info)
            return containers
        except Exception as e:
            logger.error(f"Error getting containers: {str(e)}")
            return []
    
    def _get_processor_for_container(self, container_name: str):
        """Get the appropriate log processor for a container"""
        for key, processor in self.container_patterns.items():
            if key in container_name.lower():
                return processor
        return self.container_patterns['default']
    
    async def process_log_line(self, line: str, container_name: str) -> Dict[str, Any]:
        """Process a single log line and return structured data"""
        try:
            processor = self._get_processor_for_container(container_name)
            return await processor(line, container_name)
        except Exception as e:
            logger.error(f"Error processing log line: {str(e)}")
            return self._create_error_log(str(e), line, container_name)
    
    # Processors for different log formats
    
    async def _process_elasticsearch_log(self, line: str, container_name: str) -> Dict[str, Any]:
        """Process Elasticsearch JSON logs"""
        try:
            log_data = json.loads(line)
            return {
                'timestamp': log_data.get('@timestamp', datetime.utcnow().isoformat()),
                'level': log_data.get('log.level', 'INFO'),
                'container': container_name,
                'message': log_data.get('message', line),
                'raw': line,
                'service': 'elasticsearch',
                'extra': {k: v for k, v in log_data.items() if k not in ['@timestamp', 'log.level', 'message']}
            }
        except json.JSONDecodeError:
            return await self._process_standard_log(line, container_name, service='elasticsearch')
    
    async def _process_mongodb_log(self, line: str, container_name: str) -> Dict[str, Any]:
        """Process MongoDB JSON logs"""
        try:
            log_data = json.loads(line)
            return {
                'timestamp': log_data.get('t', {}).get('$date', datetime.utcnow().isoformat()),
                'level': log_data.get('s', 'I'),
                'container': container_name,
                'message': log_data.get('msg', line),
                'raw': line,
                'service': 'mongodb',
                'context': log_data.get('c', ''),
                'component': log_data.get('c', ''),
                'extra': {k: v for k, v in log_data.items() if k not in ['t', 's', 'msg', 'c']}
            }
        except json.JSONDecodeError:
            return await self._process_standard_log(line, container_name, service='mongodb')
    
    async def _process_postgres_log(self, line: str, container_name: str) -> Dict[str, Any]:
        """Process PostgreSQL logs"""
        # Example: 2025-09-03 16:03:11.769 UTC [27] LOG:  checkpoint complete: wrote 55 buffers...
        timestamp_match = re.match(r'(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)? [A-Z]+)', line)
        if timestamp_match:
            timestamp = timestamp_match.group(1)
            remaining = line[timestamp_match.end():].strip()
            
            # Extract process ID and log level
            pid_level_match = re.match(r'\[\d+\] ([A-Z]+):\s*(.*)', remaining, re.DOTALL)
            if pid_level_match:
                level = pid_level_match.group(1)
                message = pid_level_match.group(2)
            else:
                level = 'INFO'
                message = remaining
                
            return {
                'timestamp': timestamp,
                'level': level,
                'container': container_name,
                'message': message,
                'raw': line,
                'service': 'postgres'
            }
        return await self._process_standard_log(line, container_name, service='postgres')
    
    async def _process_redis_log(self, line: str, container_name: str) -> Dict[str, Any]:
        """Process Redis logs"""
        # Example: 1:M 03 Sep 2025 16:21:38.286 * Background saving terminated with success
        redis_pattern = r'(\d+):([A-Z]) (\d{1,2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2}\.\d+) \* (.*)'
        match = re.match(redis_pattern, line)
        if match:
            pid, level, timestamp, message = match.groups()
            return {
                'timestamp': timestamp,
                'level': self._map_redis_level(level),
                'container': container_name,
                'message': message,
                'raw': line,
                'service': 'redis',
                'pid': pid
            }
        return await self._process_standard_log(line, container_name, service='redis')
    
    async def _process_kafka_log(self, line: str, container_name: str) -> Dict[str, Any]:
        """Process Kafka logs"""
        # Example: [2025-09-03 17:07:46,489] INFO [MetadataLoader 1] handleSnapshot: generated a metadata delta...
        kafka_pattern = r'\[(.*?)\]\s+([A-Z]+)\s+\[([^\]]+)\]\s+(.*)'
        match = re.match(kafka_pattern, line)
        if match:
            timestamp, level, logger, message = match.groups()
            return {
                'timestamp': timestamp,
                'level': level,
                'container': container_name,
                'message': f"[{logger}] {message}",
                'raw': line,
                'service': 'kafka',
                'logger': logger
            }
        return await self._process_standard_log(line, container_name, service='kafka')
    
    async def _process_qdrant_log(self, line: str, container_name: str) -> Dict[str, Any]:
        """Process Qdrant logs"""
        # Example: 2025-09-03T04:17:29.129433Z  INFO actix_web::middleware::logger: 172.20.0.14 "PUT /collections/..."
        qdrant_pattern = r'(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)\s+([A-Z]+)\s+([^:]+):(.*)'
        match = re.match(qdrant_pattern, line)
        if match:
            timestamp, level, logger, message = match.groups()
            return {
                'timestamp': timestamp,
                'level': level,
                'container': container_name,
                'message': message.strip(),
                'raw': line,
                'service': 'qdrant',
                'logger': logger
            }
        return await self._process_standard_log(line, container_name, service='qdrant')
    
    async def _process_standard_log(self, line: str, container_name: str, service: str = 'unknown') -> Dict[str, Any]:
        """Process standard log format"""
        # Try to find timestamp at the start of the line
        timestamp = None
        message = line
        
        # Try ISO 8601 format
        ts_match = re.match(r'(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)', line)
        if ts_match:
            timestamp = ts_match.group(1)
            message = line[ts_match.end():].strip()
        
        # Extract log level if present
        level = 'INFO'
        level_match = re.match(r'\s*\[?([A-Z]+)\]?\s*', message)
        if level_match and level_match.group(1) in ['ERROR', 'WARN', 'WARNING', 'INFO', 'DEBUG', 'TRACE']:
            level = level_match.group(1)
            message = message[level_match.end():].strip()
        
        return {
            'timestamp': timestamp or datetime.utcnow().isoformat(),
            'level': level,
            'container': container_name,
            'message': message,
            'raw': line,
            'service': service
        }
    
    def _map_redis_level(self, level: str) -> str:
        """Map Redis log levels to standard levels"""
        level_map = {
            '.': 'TRACE',
            '-': 'DEBUG',
            '*': 'INFO',
            '#': 'WARNING',
            '_': 'ERROR'
        }
        return level_map.get(level, 'INFO')
    
    def _create_error_log(self, error: str, line: str, container_name: str) -> Dict[str, Any]:
        """Create an error log entry"""
        return {
            'timestamp': datetime.utcnow().isoformat(),
            'level': 'ERROR',
            'container': container_name,
            'message': f"Error processing log: {error}",
            'raw': line,
            'service': 'log-processor',
            'error': True
        }

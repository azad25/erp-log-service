# full updated LogProcessor (drop-in replacement)

import re
import json
import logging
import subprocess
import asyncio
from datetime import datetime, timezone, timedelta
from typing import Dict, Optional, List, Any, Union, Tuple, Callable, Awaitable
from functools import lru_cache, wraps
from dataclasses import dataclass, field
from concurrent.futures import ThreadPoolExecutor
import time
from enum import Enum
import shlex
import sys
import inspect
import random
from .docker import get_docker_service

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)

class LogLevel(Enum):
    """Standard log levels with numeric values for comparison"""
    TRACE = 10
    DEBUG = 20
    INFO = 30
    WARN = 40
    ERROR = 50
    FATAL = 60

@dataclass
class LogPattern:
    timestamp: re.Pattern
    level: re.Pattern
    message_extractor: Optional[re.Pattern] = None
    multiline_start: Optional[re.Pattern] = None

@dataclass
class CacheEntry:
    data: Any
    timestamp: float
    ttl: float = 60.0
    def is_expired(self) -> bool:
        return time.time() - self.timestamp > self.ttl

@dataclass
class ProcessingMetrics:
    processed_lines: int = 0
    processing_time: float = 0.0
    cache_hits: int = 0
    cache_misses: int = 0
    errors: int = 0
    lines_per_second: float = 0.0

class LogProcessor:
    def __init__(self, 
                 max_workers: int = 4, 
                 cache_ttl: float = 300.0,
                 enable_multiline: bool = True,
                 buffer_size: int = 1000,
                 queue_size: int = 10000):
        self.max_workers = max_workers
        self.cache_ttl = cache_ttl
        self.enable_multiline = enable_multiline
        self.buffer_size = buffer_size

        self._executor = ThreadPoolExecutor(max_workers=max_workers)
        self._cache: Dict[str, CacheEntry] = {}
        self._line_buffer: Dict[str, List[str]] = {}
        
        # Docker service integration
        self._docker_service = get_docker_service()

        # Docker CLI configuration
        self.use_cli = True
        self._docker_available = None
        self._docker_check_time = None

        self._patterns = self._compile_all_patterns()
        self._container_detectors = self._build_container_detectors()
        self._log_processors = self._build_log_processors()
        self.metrics = ProcessingMetrics()

        # Lifecycle state
        self._running = False
        self._tasks: List[asyncio.Task] = []
        self._queue: Optional[asyncio.Queue] = asyncio.Queue(maxsize=queue_size)
        self._loop = None

    async def verify_docker_availability(self) -> bool:
        """Verify Docker availability using Docker service."""
        try:
            docker_service = get_docker_service()
            current_time = time.time()
            
            # Return cached result if still valid (less than 5 minutes old)
            if (self._docker_available is not None and 
                self._docker_check_time and 
                (current_time - self._docker_check_time) < 300):
                return self._docker_available
                
            # Verify connection through Docker service
            self._docker_available = await docker_service.verify_connection()
            self._docker_check_time = current_time
            
            if self._docker_available:
                logger.info("Docker service verified and available")
            else:
                logger.warning("Docker service is not available")
                
            return self._docker_available
            
        except Exception as e:
            logger.error(f"Error verifying Docker availability: {e}")
            self._docker_available = False
            self._docker_check_time = current_time
            return False

    def _build_container_detectors(self) -> Dict[str, Callable[[str], Optional[Dict[str, Any]]]]:
        """Build a dictionary of container detection functions."""
        def detect_docker_container(log_line: str) -> Optional[Dict[str, Any]]:
            """Detect if log line is from a Docker container."""
            match = re.match(r'^\S+ \[(\S+)\] \[\d+\] (.*)', log_line)
            if match:
                container_name, message = match.groups()
                return {
                    'type': 'docker',
                    'name': container_name,
                    'message': message
                }
            return None
            
        def detect_k8s_container(log_line: str) -> Optional[Dict[str, Any]]:
            """Detect if log line is from a Kubernetes pod."""
            match = re.match(r'^\S+ (\S+) (\S+) (\S+) (.*)', log_line)
            if match:
                container_type, pod_name, namespace, message = match.groups()
                if container_type.startswith('k8s_'):
                    return {
                        'type': 'kubernetes',
                        'pod': pod_name,
                        'namespace': namespace,
                        'message': message
                    }
            return None
            
        def detect_system_log(log_line: str) -> Optional[Dict[str, Any]]:
            """Detect system logs (syslog format)."""
            match = re.match(r'^(\w{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+(\S+)\s+(\S+):\s*(.*)', log_line)
            if match:
                timestamp, hostname, process, message = match.groups()
                return {
                    'type': 'system',
                    'hostname': hostname,
                    'process': process,
                    'message': message,
                    'timestamp': timestamp
                }
            return None
            
        def detect_application_log(log_line: str) -> Optional[Dict[str, Any]]:
            """Detect application logs with common patterns."""
            patterns = [
                r'^\[(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\]\s+(\w+):\s*(.*)',  # [timestamp] LEVEL: message
                r'^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\s+(\w+)\s+(.*)',  # ISO timestamp LEVEL message
                r'^(\w+):\s*(.*)$'  # LEVEL: message
            ]
            
            for pattern in patterns:
                match = re.match(pattern, log_line)
                if match:
                    groups = match.groups()
                    if len(groups) >= 2:
                        return {
                            'type': 'application',
                            'level': groups[-2] if len(groups) > 2 else groups[0],
                            'message': groups[-1],
                            'timestamp': groups[0] if len(groups) > 2 else None
                        }
            return None
            
        def detect_command_output(log_line: str) -> Optional[Dict[str, Any]]:
            """Detect command/terminal output."""
            if re.match(r'^[\w@\-]+[$#]\s+', log_line):
                return {
                    'type': 'command',
                    'subtype': 'prompt',
                    'message': log_line
                }
            elif re.match(r'^\s*\$\s+', log_line):
                return {
                    'type': 'command',
                    'subtype': 'shell',
                    'message': log_line
                }
            return None
            
        def detect_web_server_log(log_line: str) -> Optional[Dict[str, Any]]:
            """Detect web server logs (Apache/Nginx format)."""
            match = re.match(r'^(\S+)\s+-\s+-\s+\[([^\]]+)\]\s+"([^"]+)"\s+(\d+)\s+(\S+)', log_line)
            if match:
                ip, timestamp, request, status, size = match.groups()
                return {
                    'type': 'web_server',
                    'client_ip': ip,
                    'request': request,
                    'status': status,
                    'size': size,
                    'timestamp': timestamp,
                    'message': log_line
                }
            return None
            
        def detect_database_log(log_line: str) -> Optional[Dict[str, Any]]:
            """Detect database logs (PostgreSQL, MySQL, etc.)."""
            pg_match = re.match(r'^(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+\s+\w+)\s+\[(\d+)\]\s+(\w+):\s*(.*)', log_line)
            if pg_match:
                timestamp, pid, level, message = pg_match.groups()
                return {
                    'type': 'database',
                    'subtype': 'postgresql',
                    'pid': pid,
                    'level': level,
                    'message': message,
                    'timestamp': timestamp
                }
            
            mysql_match = re.match(r'^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)\s+(\d+)\s+\[(\w+)\]\s*(.*)', log_line)
            if mysql_match:
                timestamp, thread_id, level, message = mysql_match.groups()
                return {
                    'type': 'database',
                    'subtype': 'mysql',
                    'thread_id': thread_id,
                    'level': level,
                    'message': message,
                    'timestamp': timestamp
                }
            return None

        return {
            'docker': detect_docker_container,
            'kubernetes': detect_k8s_container,
            'system': detect_system_log,
            'application': detect_application_log,
            'command': detect_command_output,
            'web_server': detect_web_server_log,
            'database': detect_database_log
        }

    async def get_containers(self) -> List[Dict[str, Any]]:
        """Get list of all containers using Docker service."""
        try:
            docker_service = get_docker_service()
            if not await docker_service.verify_connection():
                logger.error("Docker service is not available")
                return []
                
            containers = await docker_service.get_containers(all=True)
            logger.info(f"Retrieved {len(containers)} containers from Docker service")
            return containers
        except Exception as e:
            logger.error(f"Error retrieving containers: {e}")
            return []

    async def _get_docker_containers(self) -> List[Dict[str, Any]]:
        """Fetch containers from Docker CLI using inspect for detailed info."""
        try:
            # First get list of container IDs
            process = await asyncio.create_subprocess_exec(
                'docker', 'ps', '-a', '--format', '{{.ID}}',
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=10.0)
            
            if process.returncode != 0:
                raise Exception(f"Docker ps command failed: {stderr.decode()}")

            container_ids = stdout.decode('utf-8').strip().split('\n')
            if not container_ids:
                logger.warning("No containers found")
                return []

            # Get detailed info for each container using inspect
            containers = []
            for container_id in container_ids:
                if not container_id.strip():
                    continue
                    
                process = await asyncio.create_subprocess_exec(
                    'docker', 'inspect', container_id,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=10.0)
                
                if process.returncode != 0:
                    logger.warning(f"Failed to inspect container {container_id}: {stderr.decode()}")
                    continue
                    
                try:
                    inspect_data = json.loads(stdout.decode('utf-8'))
                    if inspect_data and isinstance(inspect_data, list):
                        container = await self._parse_container_data(inspect_data[0])
                        if container:
                            containers.append(container)
                except json.JSONDecodeError as e:
                    logger.warning(f"Failed to parse container inspect data for {container_id}: {e}")
                    continue

            logger.info(f"Retrieved {len(containers)} containers from Docker")
            return containers

        except asyncio.TimeoutError:
            logger.error("Docker CLI command timed out")
            raise
        except Exception as e:
            logger.error(f"Docker CLI error: {e}")
            raise

    async def _parse_container_data(self, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Parse and enhance container data from Docker CLI output."""
        try:
            # Required fields
            container_id = data.get('ID') or data.get('id')
            name = data.get('Names') or data.get('name', '').lstrip('/')
            if isinstance(name, list):
                name = name[0].lstrip('/') if name else ''
            
            # Basic container info
            container = {
                'id': container_id,
                'name': name,
                'image': data.get('Image', ''),
                'status': data.get('Status', ''),
                'state': data.get('State', ''),
                'created': data.get('CreatedAt', ''),
                'ports': data.get('Ports', []),
                'labels': {},
            }

            # Parse labels if available
            labels_str = data.get('Labels', '')
            if labels_str:
                if isinstance(labels_str, str):
                    # Parse comma-separated key-value pairs
                    for label in labels_str.split(','):
                        if '=' in label:
                            k, v = label.split('=', 1)
                            container['labels'][k.strip()] = v.strip()
                elif isinstance(labels_str, dict):
                    container['labels'] = labels_str

            # Add infrastructure flag
            container['isInfra'] = self._is_infrastructure_service(container)
            
            # Add health status if available
            health = await self._extract_health_status(container_id)
            if health:
                container['health'] = health

            return container

        except Exception as e:
            logger.error(f"Error parsing container data: {e}")
            return None

    def _is_infrastructure_service(self, container: Dict[str, Any]) -> bool:
        """Determine if a container is an infrastructure service."""
        infra_keywords = {
            'proxy', 'gateway', 'router', 'loadbalancer', 'cache', 'redis',
            'postgres', 'mysql', 'mongo', 'database', 'queue', 'broker',
            'elasticsearch', 'kibana', 'grafana', 'prometheus', 'jaeger',
            'traefik', 'nginx', 'haproxy', 'consul', 'etcd', 'zookeeper'
        }
        
        name = container.get('name', '').lower()
        image = container.get('image', '').lower()
        
        # Check name and image against infrastructure keywords
        if any(keyword in name or keyword in image for keyword in infra_keywords):
            return True
            
        # Check compose labels
        labels = container.get('labels', {})
        if any(label.startswith(('com.docker.compose.', 'io.kubernetes.')) for label in labels):
            return True
            
        return False

    async def _extract_health_status(self, container_id: str) -> Optional[str]:
        """Get container health status using Docker inspect."""
        try:
            process = await asyncio.create_subprocess_exec(
                'docker', 'inspect', '--format', '{{json .State.Health}}', container_id,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=10.0)
            
            if process.returncode == 0 and stdout:
                try:
                    health_data = json.loads(stdout.decode().strip())
                    return health_data.get('Status', None)
                except json.JSONDecodeError:
                    return None
            return None
            
        except Exception:
            return None
    
    def _sanitize_log_message(self, message: str) -> str:
        """Remove invalid or non-printable characters from a log message."""
        # This regex removes all non-printable ASCII characters
        return re.sub(r'[\x00-\x1F\x7F-\x9F]', '', message)

    def _build_log_processors(self) -> Dict[str, Callable[[str], Dict[str, Any]]]:
        """Build a dictionary of log processing functions."""
        def process_json_log(log_line: str) -> Dict[str, Any]:
            """Process a JSON formatted log line."""
            try:
                data = json.loads(log_line)
                if not isinstance(data, dict):
                    data = {'message': str(data)}
                
                # Sanitize the message if it exists
                if 'message' in data and isinstance(data['message'], str):
                    data['message'] = self._sanitize_log_message(data['message'])

                return data
            except json.JSONDecodeError:
                return {
                    'message': self._sanitize_log_message(log_line),
                    'error': 'invalid_json'
                }
                
        def process_common_log(log_line: str) -> Dict[str, Any]:
            """Process a common log format line."""
            timestamp = None
            level = 'INFO'
            message = self._sanitize_log_message(log_line)
            
            ts_match = re.match(r'^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{3})', message)
            if ts_match:
                timestamp = ts_match.group(1)
                message = message[ts_match.end():].strip()
                
            level_match = re.search(r'\b(DEBUG|INFO|WARNING|ERROR|CRITICAL)\b', message, re.IGNORECASE)
            if level_match:
                level = level_match.group(1).upper()
                
            return {
                'timestamp': timestamp or datetime.now(timezone.utc).isoformat(),
                'level': level,
                'message': message
            }
            
        return {
            'json': process_json_log,
            'common': process_common_log
        }

    def _get_cache(self, key: str) -> Optional[Any]:
        """Get a value from the cache if it exists and is not expired."""
        if key not in self._cache:
            self.metrics.cache_misses += 1
            return None
            
        entry = self._cache[key]
        if entry.is_expired():
            del self._cache[key]
            self.metrics.cache_misses += 1
            return None
            
        self.metrics.cache_hits += 1
        return entry.data
        
    def _set_cache(self, key: str, value: Any, ttl: Optional[float] = None) -> None:
        """Set a value in the cache with an optional TTL."""
        if ttl is None:
            ttl = self.cache_ttl
            
        self._cache[key] = CacheEntry(
            data=value,
            timestamp=time.time(),
            ttl=ttl
        )
        
        # Clean up expired entries occasionally
        if len(self._cache) > 100:  # Only clean when cache grows large
            self._clean_cache()
            
    def _clean_cache(self) -> None:
        """Remove all expired cache entries."""
        expired_keys = [k for k, v in self._cache.items() if v.is_expired()]
        for k in expired_keys:
            del self._cache[k]

    def _compile_all_patterns(self) -> Dict[str, LogPattern]:
        """Compile all regex patterns used for log parsing."""
        patterns = {}
        
        # Common timestamp patterns - using non-capturing groups for alternatives
        iso8601 = r'\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?'
        common_log = r'\w{3} \d{1,2}, \d{4} \d{1,2}:\d{2}:\d{2} [AP]M'
        # Combined pattern with single named group
        timestamp_pattern = f'^(?P<timestamp>{iso8601}|{common_log})'
        
        # Common log level patterns
        level_pattern = r'(?P<level>TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL|CRITICAL|SEVERE)'
        
        patterns['json'] = LogPattern(
            timestamp=re.compile(r'"timestamp"\s*:\s*"([^"]+)"'),
            level=re.compile(r'"level"\s*:\s*"([^"]+)"', re.IGNORECASE),
            message_extractor=re.compile(r'"message"\s*:\s*"((?:[^"\\]|\\.)*)"', re.DOTALL)
        )
        
        patterns['common'] = LogPattern(
            timestamp=re.compile(timestamp_pattern),
            level=re.compile(level_pattern, re.IGNORECASE),
            message_extractor=re.compile(r'(?P<message>.*?)(?=\n\w{3} \d{1,2}, \d{4} \d{1,2}:\d{2}:\d{2} [AP]M|\Z)', re.DOTALL)
        )
        
        patterns['web'] = LogPattern(
            timestamp=re.compile(r'\[(?P<timestamp>[^\]]+)\]'),
            level=re.compile(r'\[(?:error|warn|info|debug|crit|alert|emerg)', re.IGNORECASE),
            message_extractor=re.compile(r'\] (?P<message>.+?)(?=\n\[|\Z)', re.DOTALL)
        )
        
        patterns['docker'] = LogPattern(
            timestamp=re.compile(r'^(?P<timestamp>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)'),
            level=re.compile(r'\b(ERROR|WARN|WARNING|INFO|DEBUG|TRACE|FATAL|CRITICAL|SEVERE)\b'),
            message_extractor=re.compile(r'\s+(?P<message>.*?)(?=\n\d{4}-\d{2}-\d{2}T|\Z)', re.DOTALL)
        )
        
        return patterns

    def _get_comprehensive_mock_data(self) -> List[Dict[str, Any]]:
        """Return comprehensive mock container data for testing and fallback scenarios."""
        statuses = ['running', 'exited', 'paused']
        images = [
            'nginx:latest',
            'postgres:13',
            'redis:alpine',
            'mongo:5.0',
            'mysql:8.0',
            'python:3.9-slim',
            'node:16-alpine',
            'mongo-express:latest',
            'adminer:latest',
            'traefik:v2.5'
        ]
        
        mock_containers = []
        for i in range(1, 6):  # Generate 5 mock containers
            container_id = f'mock-container-{i}'
            image = random.choice(images)
            name = f'mock-{image.split(":")[0].replace("/", "-")}-{i}'
            status = random.choice(statuses)
            created = (datetime.now() - timedelta(days=random.randint(0, 30), 
                                               hours=random.randint(0, 23))).isoformat()
            
            container_data = {
                'id': container_id,
                'name': name,
                'image': image,
                'status': f'{status} ({random.randint(1, 60)} minutes ago)' if status == 'running' else status,
                'labels': {
                    'com.docker.compose.project': 'mock-project',
                    'com.docker.compose.service': name,
                    'com.docker.compose.version': '1.29.2'
                },
                'isInfra': random.choice([True, False]),
                'created': created,
                'ports': [f"{random.randint(8000, 9000)}/tcp"],
                'names': [f'/{name}'],
                'imageID': f'sha256:{random.getrandbits(64):016x}',
                'command': f'docker-entrypoint.sh {name}',
                'state': status,
                'hostConfig': {
                    'networkMode': 'bridge'
                },
                'networkSettings': {
                    'networks': {
                        'bridge': {
                            'networkID': f'network-{random.getrandbits(32):08x}',
                            'ipAddress': f'172.17.0.{i}',
                            'ipPrefixLen': 16,
                            'gateway': '172.17.0.1'
                        }
                    }
                },
                'config': {
                    'hostname': name,
                    'domainname': '',
                    'user': '',
                    'attachStdin': False,
                    'attachStdout': True,
                    'attachStderr': True,
                    'exposedPorts': {
                        f'{random.randint(8000, 9000)}/tcp': {}
                    },
                    'tty': False,
                    'openStdin': False,
                    'stdinOnce': False,
                    'env': [
                        'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
                        f'SOME_ENV_VAR=value{i}'
                    ],
                    'cmd': [
                        'docker-entrypoint.sh',
                        'run'
                    ],
                    'image': image,
                    'volumes': {
                        '/data': {}
                    },
                    'workingDir': '/',
                    'entrypoint': ['/bin/sh'],
                    'onBuild': None,
                    'labels': {
                        'maintainer': 'Mock Maintainer <mock@example.com>',
                        'version': '1.0',
                        'description': 'Mock container for testing'
                    }
                },
                'mounts': [
                    {
                        'type': 'volume',
                        'name': f'{name}_data',
                        'source': f'/var/lib/docker/volumes/{name}_data/_data',
                        'destination': '/data',
                        'driver': 'local',
                        'mode': 'rw',
                        'rw': True,
                        'propagation': ''
                    }
                ],
                'graphDriver': {
                    'name': 'overlay2',
                    'data': {
                        'lowerDir': f'/var/lib/docker/overlay2/{random.getrandbits(64):016x}/diff',
                        'mergedDir': f'/var/lib/docker/overlay2/{random.getrandbits(64):016x}/merged',
                        'upperDir': f'/var/lib/docker/overlay2/{random.getrandbits(64):016x}/diff',
                        'workDir': f'/var/lib/docker/overlay2/{random.getrandbits(64):016x}/work'
                    }
                },
                'sizeRootFs': random.randint(100, 1000) * 1000000,
                'sizeRw': random.randint(10, 100) * 1000000,
                'platform': 'linux',
                'mountLabel': '',
                'appArmorProfile': 'docker-default',
                'execIDs': None
            }
            mock_containers.append(container_data)
        
        return mock_containers

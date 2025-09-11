"""
Docker Service Module
Handles all Docker-related operations using docker SDK and CLI commands.
"""

import asyncio
import logging
import json
import re
import time
from typing import Dict, List, Optional, Any
from datetime import datetime
from docker.models.containers import Container
from docker.errors import DockerException
from functools import lru_cache
from dataclasses import dataclass
from typing import Union, Optional, AsyncGenerator


logger = logging.getLogger(__name__)

@dataclass
class ContainerCache:
    """Cache entry for container data"""
    data: Dict[str, Any]
    timestamp: float
    ttl: float = 300.0  # 5 minutes default TTL

    def is_expired(self) -> bool:
        """Check if the cache entry has expired"""
        return time.time() - self.timestamp > self.ttl

class DockerService:
    def __init__(self):
        """Initialize Docker service with CLI capabilities only."""
        # Skip Docker SDK client initialization due to URL scheme issues
        # Use CLI-only approach which is more reliable
        self.client = None
        self._docker_available = False
        self._last_check_time = None
        logger.info("Docker service initialized with CLI-only mode")
        
        # Cache configuration
        self._cache_ttl = 300  # 5 minutes cache TTL
        self._container_cache = {}

    @property
    def is_available(self) -> bool:
        """Check if Docker service is available."""
        return self._docker_available

    async def verify_connection(self) -> bool:
        """Verify Docker daemon connection is working."""
        try:
            version = await self.get_version()
            self._docker_available = bool(version)
            return self._docker_available
        except Exception as e:
            logger.error(f"Docker connection verification failed: {e}")
            self._docker_available = False
            return False

    async def get_version(self) -> Optional[str]:
        """Get Docker version information."""
        try:
            if self.client:
                return self.client.version()["Version"]
            else:
                # Fallback to CLI if SDK is not available
                proc = await asyncio.create_subprocess_exec(
                    'docker', 'version', '--format', '{{.Server.Version}}',
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                stdout, _ = await proc.communicate()
                return stdout.decode().strip() if stdout else None
        except Exception as e:
            logger.error(f"Error getting Docker version: {e}")
            return None

    async def get_containers(self, all: bool = True, use_cache: bool = True) -> List[Dict[str, Any]]:
        """
        Get list of containers with their details.
        
        Args:
            all: If True, get all containers including stopped ones
            use_cache: If True, use cached results if available
        
        Returns:
            List of container details
        """
        try:
            # Try to get from cache first if enabled
            cache_key = f"containers_all_{all}"
            if use_cache:
                cached = self._get_cached_container(cache_key)
                if cached is not None:
                    return cached

            # Get fresh data
            containers = []
            if self.client:
                # Use SDK if available
                containers = self.client.containers.list(all=all)
                containers = [self._format_container_info(c) for c in containers]
            else:
                # Fallback to CLI
                containers = await self._get_containers_cli(all)

            # Cache the results
            if use_cache and containers:
                self._cache_container(cache_key, containers)
                
            return containers
        except Exception as e:
            logger.error(f"Error getting containers: {e}")
            return []

    def _format_container_info(self, container: Container) -> Dict[str, Any]:
        """Format container information into a standard structure with proper categorization."""
        try:
            state = container.attrs['State']
            config = container.attrs['Config']
            
            # Get base info
            info = {
                'id': container.id,
                'name': container.name,
                'image': container.image.tags[0] if container.image.tags else container.image.id,
                'status': container.status,
                'state': state.get('Status', 'unknown'),
                'created': container.attrs['Created'],
                'ports': self._format_ports(container),
                'labels': config.get('Labels', {}),
                'env': config.get('Env', []),
                'health': state.get('Health', {}).get('Status') if 'Health' in state else None,
                'network_settings': container.attrs.get('NetworkSettings', {}),
                'mounts': container.attrs.get('Mounts', []),
            }
            
            # Determine if it's an infrastructure service
            is_infra = self._is_infrastructure_service(info)
            info['isInfra'] = is_infra
            
            # Add additional categorization information
            info['category'] = 'infrastructure' if is_infra else 'application'
            info['type'] = self._determine_container_type(info)
            
            # Clean up name for display
            if info['name'].startswith('erp-suite-'):
                info['displayName'] = info['name'].replace('erp-suite-', '')
            else:
                info['displayName'] = info['name'].lstrip('/')
                
            # Add status badge information
            info['statusBadge'] = self._get_status_badge(info['status'])
            
            return info
        except Exception as e:
            logger.error(f"Error formatting container info: {e}")
            return {
                'id': container.id,
                'name': container.name,
                'error': str(e)
            }

    async def _get_containers_cli(self, all: bool = True) -> List[Dict[str, Any]]:
        """Get containers using Docker CLI as fallback."""
        try:
            cmd = [
                'docker', 'ps',
                '--format', '{"id":"{{.ID}}", "name":"{{.Names}}", '
                '"image":"{{.Image}}", "status":"{{.Status}}", '
                '"state":"{{.State}}", "created":"{{.CreatedAt}}"}'
            ]
            if all:
                cmd.insert(2, '-a')

            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, stderr = await proc.communicate()
            
            if proc.returncode != 0:
                logger.error(f"Docker ps command failed: {stderr.decode()}")
                return []

            containers = []
            for line in stdout.decode().strip().split('\n'):
                if line:
                    try:
                        container = json.loads(line)
                        # Enhance with inspect data if possible
                        inspect_data = await self._inspect_container_cli(container['id'])
                        if inspect_data:
                            container.update(inspect_data)
                        containers.append(container)
                    except json.JSONDecodeError:
                        continue
            return containers
        except Exception as e:
            logger.error(f"Error in CLI container listing: {e}")
            return []

    async def _inspect_container_cli(self, container_id: str) -> Optional[Dict[str, Any]]:
        """Get detailed container information using docker inspect."""
        try:
            proc = await asyncio.create_subprocess_exec(
                'docker', 'inspect', container_id,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, stderr = await proc.communicate()
            
            if proc.returncode == 0 and stdout:
                data = json.loads(stdout.decode())[0]
                return {
                    'ports': self._format_ports_cli(data),
                    'labels': data['Config'].get('Labels', {}),
                    'env': data['Config'].get('Env', []),
                    'health': data['State'].get('Health', {}).get('Status'),
                    'network_settings': data.get('NetworkSettings', {}),
                    'mounts': data.get('Mounts', [])
                }
        except Exception as e:
            logger.error(f"Error inspecting container {container_id}: {e}")
        return None

    def _format_ports(self, container: Container) -> List[Dict[str, Any]]:
        """Format container ports information."""
        try:
            ports = []
            for container_port, host_ports in container.ports.items():
                if host_ports:
                    for host_port in host_ports:
                        ports.append({
                            'container_port': container_port,
                            'host_ip': host_port['HostIp'],
                            'host_port': host_port['HostPort']
                        })
                else:
                    ports.append({'container_port': container_port})
            return ports
        except Exception:
            return []

    def _format_ports_cli(self, inspect_data: Dict) -> List[Dict[str, Any]]:
        """Format ports information from CLI inspect data."""
        try:
            ports = []
            port_bindings = inspect_data.get('HostConfig', {}).get('PortBindings', {})
            for container_port, host_ports in port_bindings.items():
                if host_ports:
                    for host_port in host_ports:
                        ports.append({
                            'container_port': container_port,
                            'host_ip': host_port['HostIp'],
                            'host_port': host_port['HostPort']
                        })
            return ports
        except Exception:
            return []

    def _determine_container_type(self, container_info: Dict[str, Any]) -> str:
        """Determine the specific type/role of the container."""
        name = container_info['name'].lower()
        image = container_info['image'].lower()
        labels = container_info.get('labels', {})

        # Database containers
        if any(db in image or db in name for db in ['postgres', 'mysql', 'mongo', 'redis', 'mariadb']):
            return 'database'

        # Message brokers
        if any(broker in image or broker in name for broker in ['rabbitmq', 'kafka', 'redis']):
            return 'message-broker'

        # Web servers and proxies
        if any(web in image or web in name for web in ['nginx', 'traefik', 'haproxy']):
            return 'web-server'

        # Monitoring tools
        if any(monitor in image or monitor in name for monitor in ['prometheus', 'grafana', 'kibana']):
            return 'monitoring'

        # API services
        if 'api' in name or 'api' in labels.get('com.docker.compose.service', ''):
            return 'api-service'

        # Frontend services
        if 'frontend' in name or 'ui' in name or 'web' in name:
            return 'frontend'

        # Background workers
        if 'worker' in name or 'processor' in name or 'scheduler' in name:
            return 'worker'

        return 'service'

    def _is_infrastructure_service(self, container_info: Dict[str, Any]) -> bool:
        """Determine if a container is an infrastructure service."""
        name = container_info['name'].lower()
        image = container_info['image'].lower()
        labels = container_info.get('labels', {})
        
        # Common infrastructure services
        infra_keywords = [
            'postgres', 'mysql', 'mariadb', 'mongodb', 'redis',
            'nginx', 'traefik', 'haproxy', 'caddy',
            'prometheus', 'grafana', 'kibana', 'elasticsearch',
            'rabbitmq', 'kafka', 'zookeeper',
            'consul', 'vault', 'etcd'
        ]
        
        # Check name and image for infrastructure keywords
        for keyword in infra_keywords:
            if keyword in name or keyword in image:
                return True
        
        # Check Docker Compose labels
        service_name = labels.get('com.docker.compose.service', '').lower()
        if any(keyword in service_name for keyword in infra_keywords):
            return True
            
        # Check for common infrastructure patterns
        if any(pattern in name for pattern in ['-db', '-database', '-cache', '-proxy', '-lb']):
            return True
            
        return False

    def _get_status_badge(self, status: str) -> Dict[str, str]:
        """Get status badge information for the frontend."""
        status = status.lower()
        
        if 'up' in status or 'running' in status:
            return {
                'class': 'bg-success',
                'icon': 'bi-check-circle',
                'text': 'Running'
            }
        elif 'exited' in status:
            return {
                'class': 'bg-danger',
                'icon': 'bi-x-circle',
                'text': 'Stopped'
            }
        elif 'created' in status:
            return {
                'class': 'bg-warning',
                'icon': 'bi-pause-circle',
                'text': 'Created'
            }
        elif 'restarting' in status:
            return {
                'class': 'bg-info',
                'icon': 'bi-arrow-clockwise',
                'text': 'Restarting'
            }
        elif 'paused' in status:
            return {
                'class': 'bg-warning',
                'icon': 'bi-pause-circle',
                'text': 'Paused'
            }
        else:
            return {
                'class': 'bg-secondary',
                'icon': 'bi-question-circle',
                'text': 'Unknown'
            }

    async def get_container_logs(
        self,
        container_id: str,
        tail: Optional[int] = None,
        since: Optional[str] = None,
        until: Optional[str] = None,
        timestamps: bool = True
    ) -> List[Dict[str, Any]]:
        """
        Get container logs with structured output.
        
        Args:
            container_id: Container ID or name
            tail: Number of log lines to return from the end
            since: Show logs since timestamp (e.g. 2013-01-02T13:23:37Z)
            until: Show logs before timestamp
            timestamps: Add timestamps to every log line
        
        Returns:
            List of structured log entries
        """
        try:
            cmd = ['docker', 'logs']
            if tail:
                cmd.extend(['--tail', str(tail)])
            if since:
                cmd.extend(['--since', since])
            if until:
                cmd.extend(['--until', until])
            if timestamps:
                cmd.append('--timestamps')
            cmd.append(container_id)

            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            stdout, stderr = await proc.communicate()
            
            # Debug logging (reduced to prevent recursive logging)
            logger.debug(f"Docker logs command: {' '.join(cmd)}")
            logger.debug(f"Return code: {proc.returncode}")
            if proc.returncode != 0:
                logger.error(f"Docker logs failed: {stderr.decode() if stderr else 'Unknown error'}")
            
            logs = []
            # Docker logs can be written to both stdout and stderr, combine them
            all_output = stdout.decode() + stderr.decode()
            for line in all_output.splitlines():
                line = line.strip()
                if not line:  # Skip empty lines
                    continue
                    
                if timestamps and line:
                    # Docker timestamp format: 2025-09-06T03:10:58.890010636Z MESSAGE
                    # Use regex to properly extract timestamp and message
                    timestamp_match = re.match(r'^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)\s*(.*)', line)
                    if timestamp_match:
                        timestamp = timestamp_match.group(1)
                        message = timestamp_match.group(2).strip()
                        
                        # Skip entries with empty messages or messages that are just timestamps
                        if not message or re.match(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s*$', message):
                            continue
                            
                        # Skip messages that contain any timestamps (nested log entries)
                        if re.search(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z', message):
                            continue
                            
                        # Skip recursive log entries from this service itself
                        if any(skip_pattern in message for skip_pattern in [
                            'Docker logs command:',
                            'Return code:',
                            'Stdout length:',
                            'Stderr:',
                            'app.services.docker:',
                            'app.services.log_streamer:',
                            'app.api.endpoints.logs:',
                            'INFO:app.',
                            'ERROR:app.',
                            'WARN:app.',
                            'DEBUG:app.',
                            'uvicorn',
                            'GET /api/v1/logs'
                        ]):
                            continue
                            
                        # Skip messages that are only whitespace or control characters
                        if not message.strip() or message.strip() == '':
                            continue
                            
                        # Skip messages that look like they're just ANSI color codes
                        clean_message = re.sub(r'\x1b\[[0-9;]*m', '', message).strip()
                        if not clean_message:
                            continue
                    else:
                        # If no timestamp pattern matches, treat entire line as message
                        timestamp = datetime.utcnow().isoformat() + 'Z'
                        message = line.strip()
                        
                        # Skip messages that contain any timestamps (nested log entries)
                        if re.search(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z', message):
                            continue
                        
                        # Skip recursive log entries
                        if any(skip_pattern in message for skip_pattern in [
                            'Docker logs command:',
                            'Return code:',
                            'Stdout length:',
                            'Stderr:',
                            'app.services.docker:',
                            'app.services.log_streamer:',
                            'app.api.endpoints.logs:',
                            'INFO:app.',
                            'ERROR:app.',
                            'WARN:app.',
                            'DEBUG:app.',
                            'uvicorn',
                            'GET /api/v1/logs'
                        ]):
                            continue
                    
                    # Extract log level from message if present
                    level = 'INFO'  # Default level
                    level_match = re.search(r'\b(TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL|CRITICAL)\b', message, re.IGNORECASE)
                    if level_match:
                        level = level_match.group(1).upper()
                        
                    logs.append({
                        'timestamp': timestamp,
                        'message': message,
                        'level': level,
                        'container_id': container_id
                    })
                else:
                    # Handle lines without timestamps
                    message = line.strip()
                    if not message:  # Skip empty messages
                        continue
                        
                    # Extract log level from message if present
                    level = 'INFO'  # Default level
                    level_match = re.search(r'\b(TRACE|DEBUG|INFO|WARN|WARNING|ERROR|FATAL|CRITICAL)\b', message, re.IGNORECASE)
                    if level_match:
                        level = level_match.group(1).upper()
                        
                    logs.append({
                        'timestamp': datetime.utcnow().isoformat() + 'Z',
                        'message': message,
                        'level': level,
                        'container_id': container_id
                    })
            return logs
        except Exception as e:
            logger.error(f"Error getting container logs: {e}")
            return []

    async def start_container(self, container_id: str) -> bool:
        """Start a container by ID or name."""
        try:
            if self.client:
                container = self.client.containers.get(container_id)
                container.start()
            else:
                proc = await asyncio.create_subprocess_exec(
                    'docker', 'start', container_id,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                _, stderr = await proc.communicate()
                if proc.returncode != 0:
                    logger.error(f"Failed to start container: {stderr.decode()}")
                    return False
            return True
        except Exception as e:
            logger.error(f"Error starting container {container_id}: {e}")
            return False

    async def stop_container(self, container_id: str, timeout: int = 10) -> bool:
        """Stop a container by ID or name."""
        try:
            if self.client:
                container = self.client.containers.get(container_id)
                container.stop(timeout=timeout)
            else:
                proc = await asyncio.create_subprocess_exec(
                    'docker', 'stop', '-t', str(timeout), container_id,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                _, stderr = await proc.communicate()
                if proc.returncode != 0:
                    logger.error(f"Failed to stop container: {stderr.decode()}")
                    return False
            return True
        except Exception as e:
            logger.error(f"Error stopping container {container_id}: {e}")
            return False

    async def restart_container(self, container_id: str, timeout: int = 10) -> bool:
        """Restart a container by ID or name."""
        try:
            if self.client:
                container = self.client.containers.get(container_id)
                container.restart(timeout=timeout)
            else:
                proc = await asyncio.create_subprocess_exec(
                    'docker', 'restart', '-t', str(timeout), container_id,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                _, stderr = await proc.communicate()
                if proc.returncode != 0:
                    logger.error(f"Failed to restart container: {stderr.decode()}")
                    return False
            return True
        except Exception as e:
            logger.error(f"Error restarting container {container_id}: {e}")
            return False

    async def pause_container(self, container_id: str) -> bool:
        """Pause a container by ID or name."""
        try:
            if self.client:
                container = self.client.containers.get(container_id)
                container.pause()
            else:
                proc = await asyncio.create_subprocess_exec(
                    'docker', 'pause', container_id,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                _, stderr = await proc.communicate()
                if proc.returncode != 0:
                    logger.error(f"Failed to pause container: {stderr.decode()}")
                    return False
            return True
        except Exception as e:
            logger.error(f"Error pausing container {container_id}: {e}")
            return False

    async def unpause_container(self, container_id: str) -> bool:
        """Unpause a container by ID or name."""
        try:
            if self.client:
                container = self.client.containers.get(container_id)
                container.unpause()
            else:
                proc = await asyncio.create_subprocess_exec(
                    'docker', 'unpause', container_id,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                _, stderr = await proc.communicate()
                if proc.returncode != 0:
                    logger.error(f"Failed to unpause container: {stderr.decode()}")
                    return False
            return True
        except Exception as e:
            logger.error(f"Error unpausing container {container_id}: {e}")
            return False

    async def get_container_stats(self, container_id: str) -> Dict[str, Any]:
        """Get container statistics including CPU, memory, network, and block I/O."""
        try:
            if self.client:
                container = self.client.containers.get(container_id)
                stats = container.stats(stream=False)
                return self._format_stats(stats)
            else:
                proc = await asyncio.create_subprocess_exec(
                    'docker', 'stats', '--no-stream', '--format', '{{json .}}', container_id,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                stdout, stderr = await proc.communicate()
                if proc.returncode != 0:
                    logger.error(f"Failed to get container stats: {stderr.decode()}")
                    return {}
                    
                raw_stats = json.loads(stdout.decode())
                
                # Parse memory usage (format: "123.4MiB / 1.234GiB")
                mem_usage_str = raw_stats.get('MemUsage', '0B / 0B')
                mem_parts = mem_usage_str.split(' / ')
                mem_usage_mb = self._parse_memory_size(mem_parts[0]) if len(mem_parts) > 0 else 0
                mem_limit_mb = self._parse_memory_size(mem_parts[1]) if len(mem_parts) > 1 else 1024
                
                # Parse network I/O (format: "123.4kB / 456.7kB")
                network_io_str = raw_stats.get('NetIO', '0B / 0B')
                net_parts = network_io_str.split(' / ')
                net_rx = self._parse_memory_size(net_parts[0]) if len(net_parts) > 0 else 0
                net_tx = self._parse_memory_size(net_parts[1]) if len(net_parts) > 1 else 0
                
                # Parse block I/O (format: "123.4MB / 456.7MB")
                block_io_str = raw_stats.get('BlockIO', '0B / 0B')
                block_parts = block_io_str.split(' / ')
                block_read = self._parse_memory_size(block_parts[0]) if len(block_parts) > 0 else 0
                block_write = self._parse_memory_size(block_parts[1]) if len(block_parts) > 1 else 0
                
                # Convert Docker CLI format to structured format matching frontend expectations
                return {
                    'cpu_percent': float(raw_stats.get('CPUPerc', '0.00%').replace('%', '')),
                    'cpu_count': 1,  # Default, could be enhanced by parsing /proc/cpuinfo
                    'memory_usage': mem_usage_mb,  # In MB
                    'memory_limit': mem_limit_mb,  # In MB
                    'memory_percent': float(raw_stats.get('MemPerc', '0.00%').replace('%', '')),
                    'network_rx': int(net_rx),
                    'network_tx': int(net_tx),
                    'block_read': int(block_read),
                    'block_write': int(block_write),
                    'pids': int(raw_stats.get('PIDs', '0')),
                    'container_name': raw_stats.get('Name', container_id),
                    'container_id': raw_stats.get('ID', container_id)
                }
        except Exception as e:
            logger.error(f"Error getting container stats for {container_id}: {e}")
            return {}

    def _format_stats(self, stats: Dict[str, Any]) -> Dict[str, Any]:
        """Format raw stats data into a more readable format."""
        try:
            return {
                'cpu_usage': self._calculate_cpu_percent(stats),
                'memory_usage': {
                    'used': stats['memory_stats']['usage'],
                    'limit': stats['memory_stats']['limit'],
                    'percent': (stats['memory_stats']['usage'] / stats['memory_stats']['limit']) * 100
                },
                'network': stats.get('networks', {}),
                'block_io': stats.get('blkio_stats', {}),
                'pids': stats.get('pids_stats', {})
            }
        except Exception as e:
            logger.error(f"Error formatting stats: {e}")
            return {}

    def _calculate_cpu_percent(self, stats: Dict[str, Any]) -> float:
        """Calculate CPU usage percentage from stats data."""
        try:
            cpu_delta = stats['cpu_stats']['cpu_usage']['total_usage'] - \
                       stats['precpu_stats']['cpu_usage']['total_usage']
            system_delta = stats['cpu_stats']['system_cpu_usage'] - \
                          stats['precpu_stats']['system_cpu_usage']
            num_cpus = len(stats['cpu_stats']['cpu_usage'].get('percpu_usage', []))
            if system_delta > 0 and num_cpus > 0:
                return (cpu_delta / system_delta) * num_cpus * 100
            return 0.0
        except Exception:
            return 0.0

    def _parse_memory_size(self, size_str: str) -> float:
        """Parse memory size string (e.g., '123.4MiB', '1.5GiB') to MB."""
        try:
            size_str = size_str.strip()
            if not size_str or size_str == '0':
                return 0.0
            
            # Extract number and unit
            import re
            match = re.match(r'^([\d.]+)([A-Za-z]*)$', size_str)
            if not match:
                return 0.0
            
            value = float(match.group(1))
            unit = match.group(2).upper()
            
            # Convert to MB
            if unit in ['B', '']:
                return value / (1024 * 1024)
            elif unit in ['KB', 'KIB']:
                return value / 1024
            elif unit in ['MB', 'MIB']:
                return value
            elif unit in ['GB', 'GIB']:
                return value * 1024
            elif unit in ['TB', 'TIB']:
                return value * 1024 * 1024
            else:
                return value  # Default to MB if unknown unit
        except Exception as e:
            logger.error(f"Error parsing memory size '{size_str}': {e}")
            return 0.0

    async def get_container_networks(self, container_id: str) -> List[Dict[str, Any]]:
        """Get detailed network information for a container."""
        try:
            if self.client:
                container = self.client.containers.get(container_id)
                return [
                    {
                        'network_name': name,
                        'network_id': network['NetworkID'],
                        'endpoints': network['EndpointID'],
                        'gateway': network['Gateway'],
                        'ip_address': network['IPAddress'],
                        'mac_address': network['MacAddress']
                    }
                    for name, network in container.attrs['NetworkSettings']['Networks'].items()
                ]
            else:
                proc = await asyncio.create_subprocess_exec(
                    'docker', 'inspect', 
                    '--format', '{{json .NetworkSettings.Networks}}',
                    container_id,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                stdout, stderr = await proc.communicate()
                if proc.returncode != 0:
                    logger.error(f"Failed to get container networks: {stderr.decode()}")
                    return []
                networks = json.loads(stdout.decode())
                return [
                    {
                        'network_name': name,
                        'network_id': network['NetworkID'],
                        'endpoints': network['EndpointID'],
                        'gateway': network['Gateway'],
                        'ip_address': network['IPAddress'],
                        'mac_address': network['MacAddress']
                    }
                    for name, network in networks.items()
                ]
        except Exception as e:
            logger.error(f"Error getting networks for container {container_id}: {e}")
            return []

    async def connect_container_to_network(self, container_id: str, network_id: str) -> bool:
        """Connect a container to a network."""
        try:
            if self.client:
                network = self.client.networks.get(network_id)
                network.connect(container_id)
            else:
                proc = await asyncio.create_subprocess_exec(
                    'docker', 'network', 'connect', network_id, container_id,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                _, stderr = await proc.communicate()
                if proc.returncode != 0:
                    logger.error(f"Failed to connect to network: {stderr.decode()}")
                    return False
            return True
        except Exception as e:
            logger.error(f"Error connecting container {container_id} to network {network_id}: {e}")
            return False

    async def disconnect_container_from_network(self, container_id: str, network_id: str) -> bool:
        """Disconnect a container from a network."""
        try:
            if self.client:
                network = self.client.networks.get(network_id)
                network.disconnect(container_id)
            else:
                proc = await asyncio.create_subprocess_exec(
                    'docker', 'network', 'disconnect', network_id, container_id,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                _, stderr = await proc.communicate()
                if proc.returncode != 0:
                    logger.error(f"Failed to disconnect from network: {stderr.decode()}")
                    return False
            return True
        except Exception as e:
            logger.error(f"Error disconnecting container {container_id} from network {network_id}: {e}")
            return False

    async def list_container_volumes(self, container_id: str) -> List[Dict[str, Any]]:
        """List volumes attached to a container."""
        try:
            if self.client:
                container = self.client.containers.get(container_id)
                return container.attrs['Mounts']
            else:
                proc = await asyncio.create_subprocess_exec(
                    'docker', 'inspect',
                    '--format', '{{json .Mounts}}',
                    container_id,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                stdout, stderr = await proc.communicate()
                if proc.returncode != 0:
                    logger.error(f"Failed to list volumes: {stderr.decode()}")
                    return []
                return json.loads(stdout.decode())
        except Exception as e:
            logger.error(f"Error listing volumes for container {container_id}: {e}")
            return []

    async def update_container_resources(
        self,
        container_id: str,
        cpu_limit: Optional[int] = None,
        memory_limit: Optional[str] = None
    ) -> bool:
        """Update container resource limits."""
        try:
            update_config = {}
            if cpu_limit is not None:
                update_config['nano_cpus'] = cpu_limit * 1e9
            if memory_limit is not None:
                update_config['memory'] = memory_limit

            if self.client:
                container = self.client.containers.get(container_id)
                container.update(**update_config)
            else:
                cmd = ['docker', 'update']
                if cpu_limit is not None:
                    cmd.extend(['--cpus', str(cpu_limit)])
                if memory_limit is not None:
                    cmd.extend(['--memory', memory_limit])
                cmd.append(container_id)

                proc = await asyncio.create_subprocess_exec(
                    *cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                _, stderr = await proc.communicate()
                if proc.returncode != 0:
                    logger.error(f"Failed to update container resources: {stderr.decode()}")
                    return False
            return True
        except Exception as e:
            logger.error(f"Error updating resources for container {container_id}: {e}")
            return False

    async def stream_container_logs(
        self,
        container_id: str,
        since: Optional[datetime] = None,
        until: Optional[datetime] = None,
        tail: Optional[Union[int, str]] = 0,  
        follow: bool = True,  
        timestamps: bool = True,  
        since_seconds: Optional[int] = None,
    ) -> AsyncGenerator[str, None]:
        """Stream logs from a container in real-time by default.

        Args:
            container_id: ID of the container
            since: Show logs since this datetime
            until: Show logs before this datetime
            tail: Number of lines to show from the end of the logs (default: 0 for new logs only)
            follow: Follow log output (default: True for real-time streaming)
            timestamps: Show timestamps (default: True)
            since_seconds: Show logs since this many seconds ago

        Yields:
            str: Log line
        """
        process = None
        try:
            # Build the docker logs command
            cmd = ['docker', 'logs']
            
            # Always follow for real-time logs
            if follow:
                cmd.append('--follow')
                
            # Always include timestamps by default
            if timestamps:
                cmd.append('--timestamps')
                
            # Only include since parameters if explicitly provided
            if since_seconds is not None:
                cmd.extend(['--since', f'{since_seconds}s'])
            elif since is not None:
                cmd.extend(['--since', since.isoformat()])
                
            # If no since parameter is provided, get recent logs for context
            if since_seconds is None and since is None:
                # Don't add --since to get some historical context
                pass
                
            if until:
                cmd.extend(['--until', until.isoformat()])
                
            # Set tail - for real-time streaming with tail=0, don't set tail to follow all new logs
            if tail is not None:
                if tail == 0:
                    # For real-time streaming, don't set tail to follow all new logs
                    pass
                else:
                    cmd.extend(['--tail', str(tail)])
                
            cmd.append(container_id)
            
            logger.debug(f"Running command: {' '.join(cmd)}")
            
            # Start the process - redirect stderr to stdout to capture all logs
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,  # Redirect stderr to stdout
                limit=1024 * 1024  # 1MB buffer
            )
            
            # Stream the output
            while True:
                try:
                    line = await asyncio.wait_for(process.stdout.readline(), timeout=1.0)
                    if not line:
                        if process.returncode is not None:
                            break
                        continue
                        
                    # Only yield non-empty lines
                    decoded_line = line.decode('utf-8').rstrip()
                    if decoded_line:
                        yield decoded_line
                        
                except asyncio.TimeoutError:
                    # Check if process is still running
                    if process.returncode is not None:
                        break
                    continue
                except Exception as e:
                    logger.error(f"Error reading from container {container_id}: {e}")
                    if not follow:
                        break
                    continue
            
            # Check for any errors
            if process.returncode != 0:
                stderr = await process.stderr.read()
                if stderr:
                    logger.error(f"Error getting logs for {container_id}: {stderr.decode()}")
                
        except asyncio.CancelledError:
            # Handle cancellation gracefully
            if process and process.returncode is None:
                process.terminate()
                try:
                    await asyncio.wait_for(process.wait(), timeout=5)
                except asyncio.TimeoutError:
                    if process.returncode is None:
                        process.kill()
            raise
            
        except Exception as e:
            logger.error(f"Error in stream_container_logs for {container_id}: {e}")
            raise
            
    def _get_cached_container(self, container_id: str) -> Optional[Dict[str, Any]]:
        """Get container data from cache if available and not expired."""
        if container_id in self._container_cache:
            cache_entry = self._container_cache[container_id]
            if not cache_entry.is_expired():
                return cache_entry.data
            else:
                del self._container_cache[container_id]
        return None
        
    def _cache_container(self, container_id: str, data: Dict[str, Any], ttl: Optional[float] = None) -> None:
        """Cache container data with optional TTL."""
        self._container_cache[container_id] = ContainerCache(
            data=data,
            timestamp=time.time(),
            ttl=ttl or self._cache_ttl
        )
        
    def _clean_container_cache(self) -> None:
        """Remove expired entries from container cache."""
        expired = [k for k, v in self._container_cache.items() if v.is_expired()]
        for k in expired:
            del self._container_cache[k]

# Global instance for easy access
_docker_service: Optional[DockerService] = None

def get_docker_service() -> DockerService:
    """Get or create the global DockerService instance."""
    global _docker_service
    if _docker_service is None:
        _docker_service = DockerService()
    return _docker_service
 
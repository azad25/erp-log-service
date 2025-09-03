import React from 'react';
import {
  Storage as DatabaseIcon,
  Dns as DnsIcon,
  Cloud as CloudIcon,
  Storage as StorageIcon,
  Web as WebIcon,
  Security as SecurityIcon,
  Settings as SettingsIcon,
  Code as CodeIcon,
  Hub as HubIcon,
  Terminal as TerminalIcon,
  Category as CategoryIcon,
} from '@mui/icons-material';

export const getContainerIcon = (containerName: string): React.ReactNode => {
  const name = containerName.toLowerCase();
  
  // Database containers
  if (name.includes('postgres') || name.includes('pg_') || name.includes('postgresql')) {
    return <DatabaseIcon fontSize="small" />;
  }
  
  if (name.includes('mongo') || name.includes('mongodb')) {
    return <StorageIcon fontSize="small" />;
  }
  
  if (name.includes('redis')) {
    return <HubIcon fontSize="small" />;
  }
  
  // Web servers and proxies
  if (name.includes('nginx') || name.includes('apache') || name.includes('caddy')) {
    return <WebIcon fontSize="small" />;
  }
  
  // Message brokers and queues
  if (name.includes('kafka') || name.includes('rabbitmq') || name.includes('nats')) {
    return <HubIcon fontSize="small" />;
  }
  
  // Monitoring and logging
  if (name.includes('prometheus') || name.includes('grafana') || name.includes('kibana')) {
    return <SettingsIcon fontSize="small" />;
  }
  
  // Application servers
  if (name.includes('node') || name.includes('express') || name.includes('fastapi') || name.includes('flask')) {
    return <CodeIcon fontSize="small" />;
  }
  
  // Default icons based on common patterns
  if (name.includes('api')) {
    return <WebIcon fontSize="small" />;
  }
  
  if (name.includes('db') || name.includes('database')) {
    return <DatabaseIcon fontSize="small" />;
  }
  
  if (name.includes('cache') || name.includes('redis') || name.includes('memcached')) {
    return <StorageIcon fontSize="small" />;
  }
  
  if (name.includes('auth') || name.includes('keycloak') || name.includes('oauth')) {
    return <SecurityIcon fontSize="small" />;
  }
  
  // Fallback to a generic icon
  return <TerminalIcon fontSize="small" />;
};

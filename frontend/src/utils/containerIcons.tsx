import React from 'react';

export const getContainerIcon = (containerName: string): React.ReactNode => {
  const name = containerName.toLowerCase();
  
  // Database containers
  if (name.includes('postgres') || name.includes('pg_') || name.includes('postgresql')) {
    return <i className="bi bi-database text-primary"></i>;
  }
  
  if (name.includes('mongo') || name.includes('mongodb')) {
    return <i className="bi bi-hdd text-success"></i>;
  }
  
  if (name.includes('redis') || name.includes('cache')) {
    return <i className="bi bi-lightning text-warning"></i>;
  }
  
  // Web servers and proxies
  if (name.includes('nginx') || name.includes('apache') || name.includes('proxy')) {
    return <i className="bi bi-globe text-info"></i>;
  }
  
  if (name.includes('consul') || name.includes('registry')) {
    return <i className="bi bi-diagram-3 text-secondary"></i>;
  }
  
  // Monitoring and management
  if (name.includes('adminer') || name.includes('phpmyadmin')) {
    return <i className="bi bi-gear text-secondary"></i>;
  }
  
  // Development tools
  if (name.includes('frontend') || name.includes('react') || name.includes('next')) {
    return <i className="bi bi-code-slash text-primary"></i>;
  }
  
  if (name.includes('api') || name.includes('gateway')) {
    return <i className="bi bi-cloud text-info"></i>;
  }
  
  if (name.includes('elasticsearch') || name.includes('elastic')) {
    return <i className="bi bi-search text-warning"></i>;
  }
  
  if (name.includes('kibana') || name.includes('grafana')) {
    return <i className="bi bi-graph-up text-success"></i>;
  }
  
  if (name.includes('auth') || name.includes('security')) {
    return <i className="bi bi-shield-check text-danger"></i>;
  }
  
  return <i className="bi bi-terminal text-muted"></i>;
};

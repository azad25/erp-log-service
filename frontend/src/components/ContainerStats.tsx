import React, { useEffect, useState } from 'react';
import { Card, ProgressBar, Badge } from 'react-bootstrap';
import { useContainerStats } from '../contexts/ContainerStatsContext';

interface ContainerStatsProps {
  containerId: string;
  className?: string;
}

const formatBytes = (bytes: number, decimals = 2): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
};

const formatPercentage = (value: number, max: number = 100): string => {
  const percentage = Math.min((value / max) * 100, 100);
  return `${percentage.toFixed(1)}%`;
};

const ContainerStats: React.FC<ContainerStatsProps> = ({ containerId, className = '' }) => {
  const { stats, isLoading, error, startWatching, stopWatching, isConnected } = useContainerStats();
  const [isWatching, setIsWatching] = useState(false);

  useEffect(() => {
    if (containerId && containerId !== 'all') {
      if (!isWatching) {
        console.log(`Starting to watch container ${containerId}`);
        startWatching(containerId);
        setIsWatching(true);
      }
      
      return () => {
        console.log(`Stopping watch on container ${containerId}`);
        stopWatching(containerId);
        setIsWatching(false);
      };
    }
  }, [containerId, startWatching, stopWatching, isWatching]);
  
  // Log connection status changes
  useEffect(() => {
    if (containerId && containerId !== 'all') {
      console.log(`Connection status for ${containerId}: ${isConnected(containerId) ? 'Connected' : 'Disconnected'}`);
    }
  }, [containerId, isConnected]);

  if (isLoading) {
    return (
      <Card className={className}>
        <Card.Body className="text-center">
          <div className="spinner-border spinner-border-sm me-2" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
          Loading container stats...
        </Card.Body>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className={className}>
        <Card.Body className="text-danger">
          <i className="bi bi-exclamation-triangle me-2" />
          {error}
        </Card.Body>
      </Card>
    );
  }

  if (containerId === 'all') {
    return (
      <Card className={className}>
        <Card.Body className="text-center text-muted">
          <i className="bi bi-info-circle me-2" />
          Select a specific container to view real-time statistics
        </Card.Body>
      </Card>
    );
  }

  if (isLoading || !stats || !stats[containerId]) {
    return (
      <Card className={className}>
        <Card.Body className="text-center">
          <div className="spinner-border spinner-border-sm" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
          <span className="ms-2">Loading container stats...</span>
          {!isConnected(containerId) && (
            <div className="mt-2">
              <small className="text-warning">
                <i className="bi bi-exclamation-triangle me-1" />
                WebSocket connection not established
              </small>
            </div>
          )}
        </Card.Body>
      </Card>
    );
  }

  const containerStats = stats[containerId];
  const memoryUsage = Number(containerStats.memoryUsage) || 0;
  const memoryLimit = Number(containerStats.memoryLimit) || 1; // Avoid division by zero
  const cpuUsage = Number(containerStats.cpuUsage) || 0;
  const cpuCount = Number(containerStats.cpuCount) || 1;
  const pids = Number(containerStats.pids) || 0;
  const networkRx = Number(containerStats.networkRx) || 0;
  const networkTx = Number(containerStats.networkTx) || 0;
  const blockRead = Number(containerStats.blockRead) || 0;
  const blockWrite = Number(containerStats.blockWrite) || 0;
  const timestamp = containerStats.timestamp || new Date().toISOString();
  
  const memoryPercentage = (memoryUsage / memoryLimit) * 100;
  const memoryVariant = memoryPercentage > 90 ? 'danger' : memoryPercentage > 70 ? 'warning' : 'success';
  
  const cpuPercentage = cpuUsage / 100; // Convert to 0-1 range
  const cpuVariant = cpuUsage > 90 ? 'danger' : cpuUsage > 70 ? 'warning' : 'success';

  return (
    <Card className={className}>
      <Card.Header className="d-flex justify-content-between align-items-center">
        <span>Container Stats</span>
        <div className="d-flex align-items-center gap-2">
          <Badge bg={isConnected(containerId) ? 'success' : 'warning'} className="ms-2">
            <i className={`bi ${isConnected(containerId) ? 'bi-wifi' : 'bi-wifi-off'} me-1`} />
            {isConnected(containerId) ? 'Live' : 'Disconnected'}
          </Badge>
          <Badge bg={pids > 0 ? 'info' : 'secondary'} className="ms-2">
            {pids} {pids === 1 ? 'Process' : 'Processes'}
          </Badge>
        </div>
      </Card.Header>
      <Card.Body>
        <div className="mb-3">
          <div className="d-flex justify-content-between mb-1">
            <span>Memory</span>
            <span>
              {formatBytes(memoryUsage)} / {formatBytes(memoryLimit)} 
              <span className="text-muted ms-1">({formatPercentage(memoryUsage, memoryLimit)})</span>
            </span>
          </div>
          <ProgressBar 
            variant={memoryVariant} 
            now={memoryPercentage} 
            className="mb-3"
            style={{ height: '10px' }}
          />
        </div>

        <div className="mb-3">
          <div className="d-flex justify-content-between mb-1">
            <span>CPU</span>
            <span>{cpuUsage.toFixed(1)}% of {cpuCount} core{cpuCount > 1 ? 's' : ''}</span>
          </div>
          <ProgressBar 
            variant={cpuVariant} 
            now={cpuUsage} 
            className="mb-3"
            style={{ height: '10px' }}
          />
        </div>

        <div className="row g-2">
          <div className="col-6">
            <div className="border rounded p-2 text-center">
              <div className="text-muted small mb-1">Network In</div>
              <div className="h5 mb-0">{formatBytes(networkRx)}/s</div>
            </div>
          </div>
          <div className="col-6">
            <div className="border rounded p-2 text-center">
              <div className="text-muted small mb-1">Network Out</div>
              <div className="h5 mb-0">{formatBytes(networkTx)}/s</div>
            </div>
          </div>
          <div className="col-6">
            <div className="border rounded p-2 text-center">
              <div className="text-muted small mb-1">Disk Read</div>
              <div className="h5 mb-0">{formatBytes(blockRead)}/s</div>
            </div>
          </div>
          <div className="col-6">
            <div className="border rounded p-2 text-center">
              <div className="text-muted small mb-1">Disk Write</div>
              <div className="h5 mb-0">{formatBytes(blockWrite)}/s</div>
            </div>
          </div>
        </div>
      </Card.Body>
      <Card.Footer className="text-muted small text-end">
        Updated: {new Date(timestamp).toLocaleTimeString()}
      </Card.Footer>
    </Card>
  );
};

export default ContainerStats;

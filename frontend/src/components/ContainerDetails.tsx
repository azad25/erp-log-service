import React, { useState, useEffect, useCallback } from 'react';
import { Modal, Button, Card, Row, Col, Badge, ProgressBar } from 'react-bootstrap';
import { ContainerInfo, LogEntry, ContainerPort } from '../types/logs';
import { startContainer, stopContainer, restartContainer } from '../services/containerService';
import { getLogs } from '../services/api';
import LogsModal from './LogsModal';
import { useContainerStats } from '../contexts/ContainerStatsContext';

interface ContainerDetailsProps {
  container: ContainerInfo | null;
  show: boolean;
  onHide: () => void;
  onContainerAction: (action: string, containerId: string) => void;
}

interface DisplayStats {
  memoryUsage: number;
  memoryLimit: number;
  cpuUsage: number;
  networkRx: number;
  networkTx: number;
  pids: number;
  blockRead: number;
  blockWrite: number;
  cpuCount: number;
  memoryPercent: number;
  timestamp: string;
}

const ContainerDetails: React.FC<ContainerDetailsProps> = ({
  container: containerProp,
  show,
  onHide,
  onContainerAction
}) => {
  // State management - all hooks must be called unconditionally at the top level
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [showLogsModal, setShowLogsModal] = useState(false);
  const [stats, setStats] = useState<DisplayStats>({
    memoryUsage: 0,
    memoryLimit: 1, // Initialize with 1 to avoid division by zero
    cpuUsage: 0,
    networkRx: 0,
    networkTx: 0,
    pids: 0,
    blockRead: 0,
    blockWrite: 0,
    cpuCount: 1,
    memoryPercent: 0,
    timestamp: new Date().toISOString()
  });
  
  // Container stats and connection
  const { stats: containerStats, startWatching, stopWatching, isConnected } = useContainerStats();
  
  // Safe container reference
  const container = containerProp;
  
  // Connection status state
  const [connectionStatus, setConnectionStatus] = useState('Disconnected');
  
  // Update connection status when container or connection state changes
  useEffect(() => {
    if (container?.id) {
      const connected = isConnected?.(container.id) || false;
      setConnectionStatus(connected ? 'Connected' : 'Disconnected');
    } else {
      setConnectionStatus('Disconnected');
    }
  }, [container?.id, isConnected]);
  
  // Status utility functions
  const getStatusColor = useCallback((status: string) => {
    if (!status) return 'secondary';
    const lowerStatus = status.toLowerCase();
    if (lowerStatus.includes('up') || lowerStatus.includes('running')) return 'success';
    if (lowerStatus.includes('exited') || lowerStatus.includes('stopped')) return 'danger';
    if (lowerStatus.includes('created') || lowerStatus.includes('starting')) return 'warning';
    if (lowerStatus.includes('paused')) return 'info';
    return 'secondary';
  }, []);
  
  // Handler for loading container logs
  const loadContainerLogs = useCallback(async (containerId: string) => {
    if (!containerId) return;
    
    try {
      setLoading(true);
      const containerLogs = await getLogs(containerId, 10);
      setLogs(containerLogs || []);
    } catch (error) {
      console.error('Failed to load container logs:', error);
      setLogs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Handler for container actions (start/stop/restart)
  const handleContainerAction = useCallback(async (action: string) => {
    if (!container?.id) return;
    
    setLoading(true);
    try {
      await onContainerAction(action, container.id);
    } catch (error) {
      console.error(`Failed to ${action} container:`, error);
    } finally {
      setLoading(false);
    }
  }, [container?.id, onContainerAction]);
  
  // Memoized handlers
  const handleClose = useCallback(() => {
    onHide();
  }, [onHide]);
  
  const handleShowLogs = useCallback(() => {
    if (container?.id) {
      loadContainerLogs(container.id);
      setShowLogsModal(true);
    }
  }, [container?.id, loadContainerLogs]);
  
  // Get container status information
  const isRunning = container?.status?.toLowerCase().includes('up') || 
                   container?.status?.toLowerCase().includes('running') || false;
  const statusColor = getStatusColor(container?.status || '');

  // Update stats when containerStats changes
  useEffect(() => {
    if (!container?.id || !containerStats?.[container.id]) {
      return;
    }

    const currentStats = containerStats[container.id];
    
    // Update stats with proper type conversion and fallbacks
    setStats(prevStats => ({
      ...prevStats,
      memoryUsage: Number(currentStats.memoryUsage) || 0,
      memoryLimit: Math.max(Number(currentStats.memoryLimit) || 1, 1), // Ensure minimum of 1MB
      cpuUsage: Number(currentStats.cpuUsage) || 0,
      networkRx: Number(currentStats.networkRx) || 0,
      networkTx: Number(currentStats.networkTx) || 0,
      pids: Number(currentStats.pids) || 0,
      blockRead: Number(currentStats.blockRead) || 0,
      blockWrite: Number(currentStats.blockWrite) || 0,
      cpuCount: Number(currentStats.cpuCount) || 1,
      memoryPercent: Number(currentStats.memoryPercent) || 0,
      timestamp: currentStats.timestamp || new Date().toISOString()
    }));
  }, [container?.id, containerStats]);

  // Handle container changes and modal open/close
  useEffect(() => {
    if (!container?.id || !show) {
      return;
    }
    
    let timeoutId: NodeJS.Timeout;
    
    // Load logs immediately
    loadContainerLogs(container.id);
    
    // Start watching stats if available
    if (startWatching) {
      console.log(`Starting to watch container ${container.id}`);
      startWatching(container.id);
    }
    
    // Cleanup function
    const cleanup = () => {
      if (stopWatching && container?.id) {
        // Delay stopping to allow for quick reopens
        timeoutId = setTimeout(() => {
          console.log(`Stopping watch on container ${container.id}`);
          stopWatching(container.id);
        }, 2000);
      }
    };
    
    return () => {
      cleanup();
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [container?.id, show, loadContainerLogs, startWatching, stopWatching]);

  // Log level color utility function
  const getLogLevelColor = useCallback((level: string) => {
    if (!level) return 'dark';
    
    switch (level.toLowerCase()) {
      case 'error':
      case 'fatal':
        return 'danger';
      case 'warn':
      case 'warning':
        return 'warning';
      case 'info':
        return 'success';
      case 'debug':
        return 'secondary';
      default:
        return 'dark';
    }
  }, []);

  // Format bytes utility function
  const formatBytes = useCallback((bytes: number) => {
    if (bytes === 0) return '0 B';
    if (!bytes || isNaN(bytes)) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const size = parseFloat((bytes / Math.pow(k, i)).toFixed(2));
    
    return `${size} ${sizes[i]}`;
  }, []);

  const formatTime = useCallback((timestamp: string) => {
    try {
      const date = new Date(timestamp);
      if (isNaN(date.getTime())) {
        return timestamp; // Return original if invalid
      }
      
      return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      });
    } catch (error) {
      console.error('Error formatting timestamp:', error);
      return timestamp;
    }
  }, []);

  // Memory usage percentage with safe division
  const memoryPercent = React.useMemo(() => {
    if (!stats.memoryLimit || stats.memoryLimit <= 0) return 0;
    const percent = (stats.memoryUsage / stats.memoryLimit) * 100;
    return Math.min(100, Math.max(0, percent));
  }, [stats.memoryUsage, stats.memoryLimit]);

  // CPU usage with bounds checking
  const cpuPercent = React.useMemo(() => {
    return Math.min(100, Math.max(0, stats.cpuUsage));
  }, [stats.cpuUsage]);

  // Early return if no container - must be after all hooks
  if (!container) return null;

  return (
    <>
      <Modal show={show} onHide={handleClose} size="lg" centered>
        <Modal.Header closeButton>
          <Modal.Title>
            {container.name || container.id}
            <Badge bg={statusColor} className="ms-2">
              {container.status || 'Unknown'}
            </Badge>
            <Badge 
              bg={isConnected?.(container.id) ? 'success' : 'warning'} 
              className="ms-2"
            >
              {connectionStatus}
            </Badge>
          </Modal.Title>
        </Modal.Header>
        
        <Modal.Body className="bg-white text-dark">
          {/* Action Buttons */}
          <div className="mb-4">
            <div className="d-flex gap-2 flex-wrap">
              <Button
                variant="success"
                size="sm"
                onClick={() => handleContainerAction('start')}
                disabled={loading || isRunning}
              >
                <i className="bi bi-play-fill me-1"></i>
                Start
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => handleContainerAction('stop')}
                disabled={loading || !isRunning}
              >
                <i className="bi bi-stop-fill me-1"></i>
                Stop
              </Button>
              <Button
                variant="warning"
                size="sm"
                onClick={() => handleContainerAction('restart')}
                disabled={loading}
              >
                <i className="bi bi-arrow-clockwise me-1"></i>
                Restart
              </Button>
              <Button
                variant="info"
                size="sm"
                onClick={handleShowLogs}
                disabled={!container.id}
              >
                <i className="bi bi-file-text me-1"></i>
                View All Logs
              </Button>
            </div>
          </div>

          {/* Container Info */}
          <Row className="mb-4">
            <Col md={6}>
              <Card className="bg-light text-dark h-100 border">
                <Card.Header>
                  <i className="bi bi-info-circle me-2"></i>
                  Container Information
                </Card.Header>
                <Card.Body>
                  <div className="mb-2">
                    <strong>ID:</strong> 
                    <code className="text-primary ms-2">
                      {container.id?.substring(0, 12) || 'N/A'}
                    </code>
                  </div>
                  <div className="mb-2">
                    <strong>Image:</strong> 
                    <code className="text-dark ms-2">{container.image || 'N/A'}</code>
                  </div>
                  <div className="mb-2">
                    <strong>Status:</strong> 
                    <Badge bg={statusColor} className="ms-2">
                      {container.status || 'Unknown'}
                    </Badge>
                  </div>
                  <div className="mb-2">
                    <strong>Created:</strong> 
                    <span className="ms-2">
                      {container.created ? formatTime(container.created) : 'N/A'}
                    </span>
                  </div>
                  <div className="mb-2">
                    <strong>Ports:</strong> 
                    {container.ports && container.ports.length > 0 ? (
                      <div className="mt-1">
                        {container.ports.map((port: string | ContainerPort, index: number) => {
                          let portStr: string;
                          
                          if (typeof port === 'string') {
                            portStr = port;
                          } else {
                            const hostIp = port.host_ip || '0.0.0.0';
                            const hostPort = port.host_port || '?';
                            const containerPort = port.container_port || '?';
                            const protocol = port.protocol ? `/${port.protocol}` : '';
                            portStr = `${hostIp}:${hostPort}→${containerPort}${protocol}`;
                          }
                          
                          return (
                            <Badge key={index} bg="primary" className="me-1 mb-1">
                              {portStr}
                            </Badge>
                          );
                        })}
                      </div>
                    ) : (
                      <span className="text-secondary ms-2">None exposed</span>
                    )}
                  </div>
                </Card.Body>
              </Card>
            </Col>
            
            <Col md={6}>
              <Card className="bg-light text-dark h-100 border">
                <Card.Header className="d-flex justify-content-between align-items-center">
                  <span>
                    <i className="bi bi-speedometer2 me-2"></i>
                    Resource Usage
                  </span>
                  <Badge bg={isConnected?.(container.id) ? 'success' : 'warning'}>
                    <i className={`bi ${isConnected?.(container.id) ? 'bi-wifi' : 'bi-wifi-off'} me-1`}></i>
                    {isConnected?.(container.id) ? 'Live' : 'Disconnected'}
                  </Badge>
                </Card.Header>
                <Card.Body>
                  {/* Memory Usage */}
                  <div className="mb-3">
                    <div className="d-flex justify-content-between mb-1">
                      <small>Memory Usage</small>
                      <small>
                        {formatBytes(stats.memoryUsage * 1024 * 1024)} / {formatBytes(stats.memoryLimit * 1024 * 1024)} 
                        ({memoryPercent.toFixed(1)}%)
                      </small>
                    </div>
                    <ProgressBar 
                      now={memoryPercent} 
                      variant={
                        memoryPercent > 90 ? 'danger' : 
                        memoryPercent > 75 ? 'warning' : 'success'
                      }
                      style={{ height: '8px' }}
                    />
                  </div>
                  
                  {/* CPU Usage */}
                  <div className="mb-3">
                    <div className="d-flex justify-content-between mb-1">
                      <small>CPU Usage</small>
                      <small>{cpuPercent.toFixed(1)}%</small>
                    </div>
                    <ProgressBar 
                      now={cpuPercent} 
                      variant={
                        cpuPercent > 90 ? 'danger' : 
                        cpuPercent > 75 ? 'warning' : 'info'
                      }
                      style={{ height: '8px' }}
                    />
                  </div>
                  
                  {/* Disk I/O */}
                  <div className="mb-3">
                    <div className="d-flex justify-content-between mb-1">
                      <small>Block I/O</small>
                      <small>
                        {formatBytes((stats.blockRead + stats.blockWrite) * 1024 * 1024)} total
                      </small>
                    </div>
                    <div className="row text-center">
                      <div className="col-6">
                        <div className="text-warning">
                          <i className="bi bi-hdd"></i> {formatBytes((stats.blockRead || 0) * 1024 * 1024)}
                        </div>
                        <small className="text-muted">Read</small>
                      </div>
                      <div className="col-6">
                        <div className="text-info">
                          <i className="bi bi-hdd-fill"></i> {formatBytes((stats.blockWrite || 0) * 1024 * 1024)}
                        </div>
                        <small className="text-muted">Write</small>
                      </div>
                    </div>
                  </div>
                  
                  {/* Network I/O */}
                  <div className="row text-center">
                    <div className="col-6">
                      <div className="text-success">
                        <i className="bi bi-arrow-down"></i> {formatBytes(stats.networkRx * 1024 * 1024)}
                      </div>
                      <small className="text-muted">Network In</small>
                    </div>
                    <div className="col-6">
                      <div className="text-primary">
                        <i className="bi bi-arrow-up"></i> {formatBytes(stats.networkTx * 1024 * 1024)}
                      </div>
                      <small className="text-muted">Network Out</small>
                    </div>
                  </div>

                  {/* Process Count */}
                  {stats.pids > 0 && (
                    <div className="mt-3 text-center">
                      <div className="text-secondary">
                        <i className="bi bi-cpu"></i> {stats.pids} processes
                      </div>
                    </div>
                  )}
                </Card.Body>
              </Card>
            </Col>
          </Row>

          {/* Recent Logs */}
          <Card className="bg-light text-dark border">
            <Card.Header className="d-flex justify-content-between align-items-center">
              <span>
                <i className="bi bi-journal-text me-2"></i>
                Recent Logs (Last 10)
              </span>
              <Button
                variant="outline-secondary"
                size="sm"
                onClick={handleShowLogs}
                disabled={!container.id}
              >
                View All
              </Button>
            </Card.Header>
            <Card.Body style={{ maxHeight: '300px', overflowY: 'auto' }}>
              {loading ? (
                <div className="text-center py-3">
                  <div className="spinner-border spinner-border-sm text-primary" role="status">
                    <span className="visually-hidden">Loading...</span>
                  </div>
                  <div className="mt-2">Loading logs...</div>
                </div>
              ) : logs.length > 0 ? (
                <div className="log-entries">
                  {logs.slice(-10).map((log, index) => {
                    const level = log.level || 'info';
                    const isError = level.toLowerCase() === 'error' || level.toLowerCase() === 'fatal';
                    
                    return (
                      <div 
                        key={`${log.timestamp}-${index}`}
                        className={`log-entry p-2 mb-2 rounded border-start border-3 ${
                          isError
                            ? 'bg-danger bg-opacity-10 border-danger' 
                            : 'bg-success bg-opacity-10 border-success'
                        }`}
                      >
                        <div className="d-flex justify-content-between align-items-start mb-1">
                          <Badge 
                            bg={getLogLevelColor(level)} 
                            className="me-2" 
                            style={{ fontSize: '0.75em' }}
                          >
                            {level.toUpperCase()}
                          </Badge>
                          <small className="text-muted">
                            {formatTime(log.timestamp)}
                          </small>
                        </div>
                        <div className="log-message">
                          <code style={{ fontSize: '0.85em', wordBreak: 'break-word' }}>
                            {log.message || log.raw || 'Empty log entry'}
                          </code>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center text-secondary py-4">
                  <i className="bi bi-journal-x fs-1"></i>
                  <div className="mt-2">No logs available</div>
                  <small className="text-muted">
                    {isRunning ? 'Container may not be producing logs' : 'Container is not running'}
                  </small>
                </div>
              )}
            </Card.Body>
          </Card>
        </Modal.Body>
        
        <Modal.Footer className="bg-light border-top">
          <Button variant="secondary" onClick={handleClose}>
            Close
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Full Logs Modal */}
      {showLogsModal && container?.id && (
        <LogsModal
          show={showLogsModal}
          onHide={() => setShowLogsModal(false)}
          containerId={container.id}
          containerName={container.name || container.id}
        />
      )}
    </>
  );
};

export default ContainerDetails;
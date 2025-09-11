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

// Reusing ContainerStats interface from ContainerStatsContext

const ContainerDetails: React.FC<ContainerDetailsProps> = ({
  container,
  show,
  onHide,
  onContainerAction
}) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [showLogsModal, setShowLogsModal] = useState(false);
  const { stats: containerStats, startWatching, stopWatching, isConnected } = useContainerStats();
  // Local state for display purposes
  interface DisplayStats {
    memoryUsage: number;
    memoryLimit: number;
    cpuUsage: number;
    diskUsage: number;
    networkRx: number;
    networkTx: number;
    pids: number;
  }

  const [stats, setStats] = useState<DisplayStats>({
    memoryUsage: 0,
    memoryLimit: 1, // Initialize with 1 to avoid division by zero
    cpuUsage: 0,
    diskUsage: 0,
    networkRx: 0,
    networkTx: 0,
    pids: 0
  });

  const loadContainerLogs = useCallback(async () => {
    if (!container) return;
    
    try {
      setLoading(true);
      const containerLogs = await getLogs(container.id, 10);
      setLogs(containerLogs || []);
    } catch (error) {
      // Silent error handling
    } finally {
      setLoading(false);
    }
  }, [container]);

  useEffect(() => {
    if (container && show) {
      loadContainerLogs();
      // Always start watching stats when modal opens, regardless of selection
      startWatching(container.id);
    }
  }, [container, show, loadContainerLogs, startWatching]);

  // Cleanup only on actual unmount - remove aggressive cleanup
  useEffect(() => {
    return () => {
      if (container) {
        // Remove setTimeout to prevent delayed disconnections
        stopWatching(container.id);
      }
    };
  }, [stopWatching]); // Remove container dependency to prevent cleanup on container changes

  // Update local stats when containerStats changes
  useEffect(() => {
    if (container && container.id && containerStats[container.id]) {
      const stats = containerStats[container.id];
      console.log('ContainerDetails: Received stats update for', container.id, stats);
      // Received stats update - values are already in MB from backend
      setStats({
        memoryUsage: Number(stats.memoryUsage) || 0,
        memoryLimit: Number(stats.memoryLimit) || 1,
        cpuUsage: Number(stats.cpuUsage) || 0,
        diskUsage: (Number(stats.blockRead) || 0) + (Number(stats.blockWrite) || 0),
        networkRx: Number(stats.networkRx) || 0,
        networkTx: Number(stats.networkTx) || 0,
        pids: Number(stats.pids) || 0
      });
    } else if (container && container.id) {
      console.log('ContainerDetails: No stats available yet for', container.id);
    }
  }, [container, containerStats]);

  const handleContainerAction = async (action: string) => {
    if (!container) return;
    
    try {
      setLoading(true);
      
      switch (action) {
        case 'start':
          await startContainer(container.id);
          break;
        case 'stop':
          await stopContainer(container.id);
          break;
        case 'restart':
          await restartContainer(container.id);
          break;
        default:
          return;
      }
      
      onContainerAction(action, container.id);
      
      // Stats will update automatically via WebSocket
      
    } catch (error) {
      // Silent error handling
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    if (status.toLowerCase().includes('up')) return 'success';
    if (status.toLowerCase().includes('exited')) return 'danger';
    if (status.toLowerCase().includes('created')) return 'warning';
    return 'secondary';
  };

  const getLogLevelColor = (level: string) => {
    switch (level?.toLowerCase()) {
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
        return 'light';
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatTime = (timestamp: string) => {
    try {
      const date = new Date(timestamp);
      return date.toLocaleString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });
    } catch {
      return timestamp;
    }
  };

  if (!container) return null;

  const isRunning = container.status.toLowerCase().includes('up');
  // Use backend-provided memory percentage for accuracy
  const memoryPercent = container && container.id && containerStats[container.id] 
    ? containerStats[container.id].memoryPercent 
    : (stats.memoryLimit > 0 ? (stats.memoryUsage / stats.memoryLimit) * 100 : 0);

  return (
    <>
      <Modal show={show} onHide={onHide} size="lg" className="container-details-modal" contentClassName="bg-white">
        <Modal.Header closeButton className="bg-light border-secondary">
          <Modal.Title className="d-flex align-items-center">
            <i className={`bi ${isRunning ? 'bi-play-circle text-success' : 'bi-stop-circle text-danger'} me-2`}></i>
            {container.name.replace('erp-suite-', '')}
            <Badge bg={getStatusColor(container.status)} className="ms-2">
              {isRunning ? 'Running' : 'Stopped'}
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
                onClick={() => setShowLogsModal(true)}
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
                    <strong>ID:</strong> <code className="text-primary">{container.id}</code>
                  </div>
                  <div className="mb-2">
                    <strong>Image:</strong> <code className="text-dark">{container.image}</code>
                  </div>
                  <div className="mb-2">
                    <strong>Created:</strong> {container.created ? formatTime(container.created) : 'N/A'}
                  </div>
                  <div className="mb-2">
                    <strong>Ports:</strong> 
                    {container.ports && container.ports.length > 0 ? (
                      <div className="mt-1">
                        {container.ports.map((port: string | ContainerPort, index: number) => {
                          // Handle both string and object port formats
                          const portStr = typeof port === 'string' 
                            ? port 
                            : `${port.host_ip || '0.0.0.0'}:${port.host_port || '?'}->${port.container_port || '?'}${port.protocol ? `/${port.protocol}` : ''}`;
                          
                          return (
                            <Badge key={index} bg="primary" className="me-1 mb-1">
                              {portStr}
                            </Badge>
                          );
                        })}
                      </div>
                    ) : (
                      <span className="text-secondary"> None exposed</span>
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
                  {container && (
                    <Badge bg={isConnected(container.id) ? 'success' : 'warning'}>
                      <i className={`bi ${isConnected(container.id) ? 'bi-wifi' : 'bi-wifi-off'} me-1`}></i>
                      {isConnected(container.id) ? 'Live' : 'Disconnected'}
                    </Badge>
                  )}
                </Card.Header>
                <Card.Body>
                  <div className="mb-3">
                    <div className="d-flex justify-content-between mb-1">
                      <small>Memory Usage</small>
                      <small>{formatBytes(stats.memoryUsage * 1024 * 1024)} / {formatBytes(stats.memoryLimit * 1024 * 1024)} ({memoryPercent.toFixed(1)}%)</small>
                    </div>
                    <ProgressBar 
                      now={memoryPercent} 
                      variant={memoryPercent > 80 ? 'danger' : memoryPercent > 60 ? 'warning' : 'success'}
                      style={{ height: '8px' }}
                    />
                  </div>
                  
                  <div className="mb-3">
                    <div className="d-flex justify-content-between mb-1">
                      <small>CPU Usage</small>
                      <small>{stats.cpuUsage.toFixed(1)}%</small>
                    </div>
                    <ProgressBar 
                      now={stats.cpuUsage} 
                      variant={stats.cpuUsage > 80 ? 'danger' : stats.cpuUsage > 60 ? 'warning' : 'info'}
                      style={{ height: '8px' }}
                    />
                  </div>
                  
                  <div className="mb-3">
                    <div className="d-flex justify-content-between mb-1">
                      <small>Disk I/O</small>
                      <small>{formatBytes(stats.diskUsage * 1024 * 1024)} total</small>
                    </div>
                    <div className="row text-center">
                      <div className="col-6">
                        <div className="text-warning">
                          <i className="bi bi-hdd"></i> {formatBytes((Number(containerStats[container?.id || '']?.blockRead) || 0) * 1024 * 1024)}
                        </div>
                        <small className="text-muted">Read</small>
                      </div>
                      <div className="col-6">
                        <div className="text-info">
                          <i className="bi bi-hdd-fill"></i> {formatBytes((Number(containerStats[container?.id || '']?.blockWrite) || 0) * 1024 * 1024)}
                        </div>
                        <small className="text-muted">Write</small>
                      </div>
                    </div>
                  </div>
                  
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
                variant="outline-light"
                size="sm"
                onClick={() => setShowLogsModal(true)}
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
                </div>
              ) : logs.length > 0 ? (
                <div className="log-entries">
                  {logs.slice(-10).map((log, index) => (
                    <div 
                      key={index} 
                      className={`log-entry p-2 mb-2 rounded border-start border-3 ${
                        log.level?.toLowerCase() === 'error' || log.level?.toLowerCase() === 'fatal' 
                          ? 'bg-danger bg-opacity-10 border-danger' 
                          : 'bg-success bg-opacity-10 border-success'
                      }`}
                      style={{
                        animation: `slideIn 0.3s ease-out ${index * 0.1}s both`
                      }}
                    >
                      <div className="d-flex justify-content-between align-items-start mb-1">
                        <Badge 
                          bg={getLogLevelColor(log.level || 'info')} 
                          className="me-2" 
                          style={{
                            backgroundColor: getLogLevelColor(log.level || 'info') === 'success' ? '#28a745' : undefined,
                            color: 'white',
                            fontWeight: '500',
                            fontSize: '0.8em',
                            padding: '0.35em 0.65em'
                          }}
                        >
                          {log.level || 'INFO'}
                        </Badge>
                        <small className="text-dark">
                          {formatTime(log.timestamp)}
                        </small>
                      </div>
                      <div className="log-message">
                        {(() => {
                          try {
                            // Try to parse as JSON for pretty printing
                            const message = log.message || log.raw || '';
                            const jsonMatch = message.match(/^({[\s\S]*}|\[[\s\S]*\])$/);
                            
                            if (jsonMatch) {
                              const parsed = JSON.parse(message);
                              return (
                                <pre className="mb-0">
                                  <code>
                                    {JSON.stringify(parsed, null, 2)}
                                  </code>
                                </pre>
                              );
                            }
                            return <code>{message}</code>;
                          } catch (e) {
                            // If not valid JSON, return as plain text
                            return <code>{log.message || log.raw}</code>;
                          }
                        })()}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center text-secondary py-3">
                  <i className="bi bi-journal-x fs-1"></i>
                  <div>No logs available</div>
                </div>
              )}
            </Card.Body>
          </Card>
        </Modal.Body>
        
        <Modal.Footer className="bg-light border-secondary">
          <Button variant="secondary" onClick={onHide}>
            Close
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Full Logs Modal */}
      <LogsModal
        show={showLogsModal}
        onHide={() => setShowLogsModal(false)}
        containerId={container.id}
        containerName={container.name}
      />
    </>
  );
};

export default ContainerDetails;
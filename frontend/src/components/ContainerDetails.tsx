import React, { useState, useEffect } from 'react';
import { Modal, Button, Card, Row, Col, Badge, ProgressBar } from 'react-bootstrap';
import { ContainerInfo, LogEntry } from '../types/logs';
import { startContainer, stopContainer, restartContainer } from '../services/containerService';
import { getLogs } from '../services/api';
import LogsModal from './LogsModal';

interface ContainerDetailsProps {
  container: ContainerInfo | null;
  show: boolean;
  onHide: () => void;
  onContainerAction: (action: string, containerId: string) => void;
}

interface ContainerStats {
  memoryUsage: number;
  memoryLimit: number;
  cpuUsage: number;
  diskUsage: number;
  networkRx: number;
  networkTx: number;
}

const ContainerDetails: React.FC<ContainerDetailsProps> = ({
  container,
  show,
  onHide,
  onContainerAction
}) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [showLogsModal, setShowLogsModal] = useState(false);
  const [stats, setStats] = useState<ContainerStats>({
    memoryUsage: 0,
    memoryLimit: 0,
    cpuUsage: 0,
    diskUsage: 0,
    networkRx: 0,
    networkTx: 0
  });

  useEffect(() => {
    if (container && show) {
      loadContainerLogs();
      loadContainerStats();
    }
  }, [container, show]);

  const loadContainerLogs = async () => {
    if (!container) return;
    
    try {
      setLoading(true);
      const containerLogs = await getLogs(container.id, 10);
      setLogs(containerLogs || []);
    } catch (error) {
      console.error('Error loading container logs:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadContainerStats = () => {
    // Mock stats for now - in real implementation, this would fetch from Docker API
    setStats({
      memoryUsage: Math.random() * 512,
      memoryLimit: 512,
      cpuUsage: Math.random() * 100,
      diskUsage: Math.random() * 100,
      networkRx: Math.random() * 1024,
      networkTx: Math.random() * 1024
    });
  };

  const handleContainerAction = async (action: string) => {
    if (!container) return;
    
    try {
      setLoading(true);
      let result;
      
      switch (action) {
        case 'start':
          result = await startContainer(container.id);
          break;
        case 'stop':
          result = await stopContainer(container.id);
          break;
        case 'restart':
          result = await restartContainer(container.id);
          break;
        default:
          return;
      }
      
      onContainerAction(action, container.id);
      
      // Reload stats after action
      setTimeout(loadContainerStats, 1000);
      
    } catch (error) {
      console.error(`Error ${action}ing container:`, error);
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
        return 'info';
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
  const memoryPercent = stats.memoryLimit > 0 ? (stats.memoryUsage / stats.memoryLimit) * 100 : 0;

  return (
    <>
      <Modal show={show} onHide={onHide} size="lg" className="container-details-modal">
        <Modal.Header closeButton className="bg-dark text-light border-secondary">
          <Modal.Title className="d-flex align-items-center">
            <i className={`bi ${isRunning ? 'bi-play-circle text-success' : 'bi-stop-circle text-danger'} me-2`}></i>
            {container.name.replace('erp-suite-', '')}
            <Badge bg={getStatusColor(container.status)} className="ms-2">
              {isRunning ? 'Running' : 'Stopped'}
            </Badge>
          </Modal.Title>
        </Modal.Header>
        
        <Modal.Body className="bg-dark text-light">
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
              <Card className="bg-secondary text-light h-100">
                <Card.Header>
                  <i className="bi bi-info-circle me-2"></i>
                  Container Information
                </Card.Header>
                <Card.Body>
                  <div className="mb-2">
                    <strong>ID:</strong> <code className="text-info">{container.id}</code>
                  </div>
                  <div className="mb-2">
                    <strong>Image:</strong> <code className="text-warning">{container.image}</code>
                  </div>
                  <div className="mb-2">
                    <strong>Created:</strong> {formatTime(container.created)}
                  </div>
                  <div className="mb-2">
                    <strong>Ports:</strong> 
                    {container.ports && container.ports.length > 0 ? (
                      <div className="mt-1">
                        {container.ports.map((port, index) => (
                          <Badge key={index} bg="primary" className="me-1">
                            {port}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <span className="text-muted"> None exposed</span>
                    )}
                  </div>
                </Card.Body>
              </Card>
            </Col>
            
            <Col md={6}>
              <Card className="bg-secondary text-light h-100">
                <Card.Header>
                  <i className="bi bi-speedometer2 me-2"></i>
                  Resource Usage
                </Card.Header>
                <Card.Body>
                  <div className="mb-3">
                    <div className="d-flex justify-content-between mb-1">
                      <small>Memory Usage</small>
                      <small>{formatBytes(stats.memoryUsage * 1024 * 1024)} / {formatBytes(stats.memoryLimit * 1024 * 1024)}</small>
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
                  
                  <div className="row text-center">
                    <div className="col-6">
                      <div className="text-success">
                        <i className="bi bi-arrow-down"></i> {formatBytes(stats.networkRx)}
                      </div>
                      <small className="text-muted">Network In</small>
                    </div>
                    <div className="col-6">
                      <div className="text-primary">
                        <i className="bi bi-arrow-up"></i> {formatBytes(stats.networkTx)}
                      </div>
                      <small className="text-muted">Network Out</small>
                    </div>
                  </div>
                </Card.Body>
              </Card>
            </Col>
          </Row>

          {/* Recent Logs */}
          <Card className="bg-secondary text-light">
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
                        <Badge bg={getLogLevelColor(log.level || 'info')} className="me-2">
                          {log.level || 'INFO'}
                        </Badge>
                        <small className="text-muted">
                          {formatTime(log.timestamp)}
                        </small>
                      </div>
                      <div className="log-message">
                        {log.message || log.raw}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center text-muted py-3">
                  <i className="bi bi-journal-x fs-1"></i>
                  <div>No logs available</div>
                </div>
              )}
            </Card.Body>
          </Card>
        </Modal.Body>
        
        <Modal.Footer className="bg-dark border-secondary">
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
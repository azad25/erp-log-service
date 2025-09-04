import React, { useState, useEffect } from 'react';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';

// Types
interface ContainerInfo {
  id: string;
  name: string;
  status: string;
  isInfra?: boolean;
  image?: string;
  created?: string;
  ports?: string[];
}

interface ContainerListProps {
  containers: ContainerInfo[];
  selectedContainer: string;
  onSelectContainer: (containerId: string) => void;
  onRefresh: () => void;
}

// LogModalContent Component
const LogModalContent: React.FC<{ containerId: string; onClose: () => void }> = ({ 
  containerId, 
  onClose 
}) => {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
  if (!containerId) return;

  const fetchLogs = async () => {
      setLoading(true);
      setError('');
      try {
        const response = await fetch(`/api/v1/logs/${containerId}?limit=100`);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        setLogs(Array.isArray(data) ? data : []);
      } catch (err) {
        setError(`Failed to fetch logs: ${err instanceof Error ? err.message : 'Unknown error'}`);
        setLogs([]);
      } finally {
        setLoading(false);
      }
    };

    fetchLogs();
  }, [containerId]);

  const refreshLogs = () => {
    const fetchLogs = async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/v1/logs/${containerId}?limit=100`);
        const data = await response.json();
        setLogs(Array.isArray(data) ? data : []);
      } catch (err) {
        setError(`Failed to refresh logs: ${err instanceof Error ? err.message : 'Unknown error'}`);
      } finally {
        setLoading(false);
      }
    };
    fetchLogs();
  };

  if (loading) {
    return (
      <div className="d-flex justify-content-center py-4">
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">Loading...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="alert alert-danger" role="alert">
        <i className="bi bi-exclamation-triangle me-2"></i>
        {error}
      </div>
    );
  }

  return (
    <div className="h-100 d-flex flex-column">
      <div className="d-flex justify-content-between align-items-center p-3 border-bottom">
        <div className="d-flex align-items-center">
          <h5 className="modal-title mb-0">Container Logs: {containerId}</h5>
          <button 
            className="btn btn-outline-secondary btn-sm ms-3"
            onClick={refreshLogs}
            disabled={loading}
          >
            <i className="bi bi-arrow-clockwise me-1"></i>
            Refresh
          </button>
        </div>
        <button 
          type="button" 
          className="btn-close" 
          onClick={onClose}
          aria-label="Close"
        ></button>
      </div>

      <div className="flex-grow-1 overflow-auto p-3" style={{ backgroundColor: '#1a1a1a' }}>
        {logs.length === 0 ? (
          <div className="text-center text-muted py-4">
            <i className="bi bi-file-text fs-1 d-block mb-3"></i>
            <p>No logs found for this container.</p>
          </div>
        ) : (
          <div className="log-entries">
            {logs.map((log, idx) => {
              const isError = log.level === 'ERROR' || log.level === 'FATAL';
              const isWarning = log.level === 'WARN' || log.level === 'WARNING';
              
              return (
                <div
                  key={log.id || idx}
                  className="log-entry mb-2 p-2 rounded font-monospace small slide-in"
                  style={{
                    backgroundColor: isError 
                      ? 'rgba(220, 53, 69, 0.1)'
                      : isWarning
                      ? 'rgba(255, 193, 7, 0.1)'
                      : 'rgba(25, 135, 84, 0.1)',
                    border: `1px solid ${isError 
                      ? 'rgba(220, 53, 69, 0.3)'
                      : isWarning
                      ? 'rgba(255, 193, 7, 0.3)'
                      : 'rgba(25, 135, 84, 0.3)'}`,
                    color: '#ffffff',
                    animationDelay: `${idx * 0.1}s`
                  }}
                >
                  <div className="d-flex align-items-start">
                    <span 
                      className={`badge me-2 ${isError
                        ? 'bg-danger'
                        : isWarning
                        ? 'bg-warning text-dark'
                        : log.level === 'INFO'
                        ? 'bg-info'
                        : 'bg-secondary'}`}
                    >
                      {log.level}
                    </span>
                    <span className="text-muted me-2" style={{ fontSize: '0.8rem' }}>
                      {log.formatted_time || log.timestamp}
                    </span>
                    <span className="flex-grow-1" style={{ wordBreak: 'break-word' }}>
                      {log.message}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

// Container service functions
const containerService = {
  start: async (containerId: string) => {
    const response = await fetch(`/api/v1/containers/${containerId}/start`, {
      method: 'POST',
    });
    if (!response.ok) throw new Error('Failed to start container');
    return response.json();
  },
  stop: async (containerId: string) => {
    const response = await fetch(`/api/v1/containers/${containerId}/stop`, {
      method: 'POST',
    });
    if (!response.ok) throw new Error('Failed to stop container');
    return response.json();
  },
  restart: async (containerId: string) => {
    const response = await fetch(`/api/v1/containers/${containerId}/restart`, {
      method: 'POST',
    });
    if (!response.ok) throw new Error('Failed to restart container');
    return response.json();
  }
};

const getContainerIcon = (name: string): string => {
  if (name.includes('postgres') || name.includes('db')) return 'database';
  if (name.includes('redis') || name.includes('cache')) return 'lightning';
  if (name.includes('nginx') || name.includes('proxy')) return 'globe';
  if (name.includes('rabbitmq') || name.includes('kafka')) return 'envelope';
  if (name.includes('api')) return 'code-slash';
  if (name.includes('web')) return 'browser-chrome';
  return 'box';
};

// Main ContainerList Component
const ContainerList: React.FC<ContainerListProps> = ({
  containers,
  selectedContainer,
  onSelectContainer,
  onRefresh
}) => {
  const [logsModalOpen, setLogsModalOpen] = useState(false);
  const [selectedContainerLogs, setSelectedContainerLogs] = useState<ContainerInfo | null>(null);
  const [loadingActions, setLoadingActions] = useState<Record<string, boolean>>({});

    // close modal on Escape
    useEffect(() => {
      const handleKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape' && logsModalOpen) {
          setLogsModalOpen(false);
        }
      };
      window.addEventListener('keydown', handleKey);
      return () => window.removeEventListener('keydown', handleKey);
    }, [logsModalOpen]);

  const handleContainerAction = async (
    containerId: string,
    action: 'start' | 'stop' | 'restart'
  ) => {
    try {
      setLoadingActions(prev => ({ ...prev, [containerId]: true }));
      
      switch (action) {
        case 'start':
          await containerService.start(containerId);
          break;
        case 'stop':
          await containerService.stop(containerId);
          break;
        case 'restart':
          await containerService.restart(containerId);
          break;
      }
      
      setTimeout(onRefresh, 1000);
    } catch (error) {
      console.error(`Error ${action}ing container:`, error);
      alert(`Failed to ${action} container: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setLoadingActions(prev => ({ ...prev, [containerId]: false }));
    }
  };

  const getStatusColor = (status: string): string => {
    switch (status.toLowerCase()) {
      case 'running':
        return 'success';
      case 'exited':
      case 'dead':
        return 'danger';
      case 'restarting':
      case 'paused':
        return 'warning';
      default:
        return 'secondary';
    }
  };

  const getStatusIcon = (status: string): string => {
    switch (status.toLowerCase()) {
      case 'running':
        return 'circle-fill text-success';
      case 'exited':
      case 'dead':
        return 'circle-fill text-danger';
      case 'restarting':
      case 'paused':
        return 'circle-fill text-warning';
      default:
        return 'circle text-secondary';
    }
  };

  const handleViewLogs = (container: ContainerInfo) => {
    setSelectedContainerLogs(container);
    setLogsModalOpen(true);
  };

  const handleCloseLogsModal = () => {
    setLogsModalOpen(false);
    setSelectedContainerLogs(null);
  };

  const appContainers = containers.filter(c => !c.isInfra);
  const infraContainers = containers.filter(c => c.isInfra);

  const renderContainerItem = (container: ContainerInfo) => {
    const isRunning = container.status.toLowerCase() === 'running';
    const isLoading = loadingActions[container.id];

    return (
      <div
        key={container.id}
        className={`list-group-item list-group-item-action ${
          selectedContainer === container.id ? 'active' : ''
        }`}
        style={{ cursor: 'pointer' }}
      >
        <div className="d-flex align-items-center" onClick={() => onSelectContainer(container.id)}>
          <i 
            className={`bi bi-${getStatusIcon(container.status)} me-2`}
            title={`Status: ${container.status}`}
          ></i>
          
          <i className={`bi bi-${getContainerIcon(container.name)} me-3 text-primary`}></i>
          
          <div className="flex-grow-1">
            <div className="d-flex w-100 justify-content-between">
              <h6 className="mb-1">{container.name}</h6>
              <small className={`text-${getStatusColor(container.status)}`}>
                {container.status}
              </small>
            </div>
            <p className="mb-1 text-muted small">
              {container.image || 'No image info'}
            </p>
          </div>

          <div className="btn-group btn-group-sm ms-2" role="group">
            <button
              type="button"
              className="btn btn-outline-info"
              title="View Logs"
              onClick={(e) => {
                e.stopPropagation();
                handleViewLogs(container);
              }}
            >
              <i className="bi bi-file-text"></i>
            </button>

            <button
              type="button"
              className="btn btn-outline-success"
              title="Start Container"
              disabled={isRunning || isLoading}
              onClick={(e) => {
                e.stopPropagation();
                handleContainerAction(container.id, 'start');
              }}
            >
              {isLoading ? (
                <span className="spinner-border spinner-border-sm"></span>
              ) : (
                <i className="bi bi-play-fill"></i>
              )}
            </button>

            <button
              type="button"
              className="btn btn-outline-danger"
              title="Stop Container"
              disabled={!isRunning || isLoading}
              onClick={(e) => {
                e.stopPropagation();
                handleContainerAction(container.id, 'stop');
              }}
            >
              <i className="bi bi-stop-fill"></i>
            </button>

            <button
              type="button"
              className="btn btn-outline-warning"
              title="Restart Container"
              disabled={isLoading}
              onClick={(e) => {
                e.stopPropagation();
                handleContainerAction(container.id, 'restart');
              }}
            >
              <i className="bi bi-arrow-clockwise"></i>
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="container-list">
        {appContainers.length > 0 && (
          <div className="mb-4">
            <h5 className="text-primary mb-3">
              <i className="bi bi-app me-2"></i>
              Application Services
            </h5>
            <div className="list-group">
              {appContainers.map(renderContainerItem)}
            </div>
          </div>
        )}

        {infraContainers.length > 0 && (
          <div className="mb-4">
            <h5 className="text-secondary mb-3">
              <i className="bi bi-gear me-2"></i>
              Infrastructure Services
            </h5>
            <div className="list-group">
              {infraContainers.map(renderContainerItem)}
            </div>
          </div>
        )}

        {containers.length === 0 && (
          <div className="text-center py-5">
            <i className="bi bi-inbox display-1 text-muted"></i>
            <h4 className="text-muted mt-3">No containers found</h4>
            <p className="text-muted">Start some containers to see them here.</p>
          </div>
        )}
      </div>

      {logsModalOpen && (
        <div className="modal show d-block" tabIndex={-1} style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-fullscreen">
            <div className="modal-content">
              <LogModalContent 
                containerId={selectedContainerLogs?.id || ''} 
                onClose={handleCloseLogsModal}
              />
            </div>
          </div>
        </div>
      )}

      <style dangerouslySetInnerHTML={{
        __html: `
          .slide-in {
            animation: slideIn 0.3s ease-out forwards;
          }

          @keyframes slideIn {
            from {
              opacity: 0;
              transform: translateY(-10px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }

          .list-group-item-action:hover {
            transform: translateY(-2px);
            transition: transform 0.2s ease;
            box-shadow: 0 4px 8px rgba(0,0,0,0.1);
          }

          .log-entry {
            transition: all 0.3s ease;
          }

          .log-entry:hover {
            transform: translateX(5px);
          }

          .btn-group .btn {
            margin: 0 1px;
          }

          .modal-content {
            height: 100vh;
          }

          .log-entries {
            max-height: calc(100vh - 200px);
            overflow-y: auto;
          }

          .log-entries::-webkit-scrollbar {
            width: 8px;
          }

          .log-entries::-webkit-scrollbar-track {
            background: rgba(255,255,255,0.1);
          }

          .log-entries::-webkit-scrollbar-thumb {
            background: rgba(255,255,255,0.3);
            border-radius: 4px;
          }

          .log-entries::-webkit-scrollbar-thumb:hover {
            background: rgba(255,255,255,0.5);
          }
        `
      }} />
    </>
  );
};

export default ContainerList;
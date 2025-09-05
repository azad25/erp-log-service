import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Modal, Button, Form, Badge, InputGroup } from 'react-bootstrap';
import { LogEntry } from '../types/logs';
import { getLogs } from '../services/api';

interface LogsModalProps {
  show: boolean;
  onHide: () => void;
  containerId: string;
  containerName: string;
}

const LogsModal: React.FC<LogsModalProps> = ({
  show,
  onHide,
  containerId,
  containerName
}) => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [levelFilter, setLevelFilter] = useState('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);

  const loadLogs = useCallback(async () => {
    try {
      setLoading(true);
      const containerLogs = await getLogs(containerId, 500);
      setLogs(containerLogs || []);
    } catch (error) {
      console.error('Error loading logs:', error);
    } finally {
      setLoading(false);
    }
  }, [containerId]);

  useEffect(() => {
    if (show && containerId) {
      loadLogs();
    }
  }, [show, containerId, loadLogs]);

  useEffect(() => {
    if (autoScroll && logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);


  const loadMoreLogs = async () => {
    try {
      setLoading(true);
      // In a real implementation, this would load older logs
      const moreLogs = await getLogs(containerId, logs.length + 100);
      setLogs(moreLogs || []);
    } catch (error) {
      console.error('Error loading more logs:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredLogs = logs.filter(log => {
    const matchesSearch = !searchTerm || 
      (log.message && log.message.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (log.raw && log.raw.toLowerCase().includes(searchTerm.toLowerCase()));
    
    const matchesLevel = levelFilter === 'all' || 
      (log.level && log.level.toLowerCase() === levelFilter.toLowerCase());
    
    return matchesSearch && matchesLevel;
  });

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

  const formatTime = (timestamp: string) => {
    try {
      const date = new Date(timestamp);
      return date.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
      });
    } catch {
      return timestamp;
    }
  };

  const handleScroll = () => {
    if (logsContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = logsContainerRef.current;
      const isAtBottom = scrollTop + clientHeight >= scrollHeight - 10;
      setAutoScroll(isAtBottom);
    }
  };

  return (
    <Modal 
      show={show} 
      onHide={onHide} 
      size="xl" 
      className="logs-modal"
      fullscreen="lg-down"
    >
      <Modal.Header closeButton className="bg-dark text-light border-secondary">
        <Modal.Title className="d-flex align-items-center">
          <i className="bi bi-file-text me-2"></i>
          Logs: {containerName.replace('erp-suite-', '')}
          <Badge bg="secondary" className="ms-2">
            {filteredLogs.length} entries
          </Badge>
        </Modal.Title>
      </Modal.Header>
      
      <Modal.Body className="bg-dark text-light p-0">
        {/* Filters */}
        <div className="p-3 border-bottom border-secondary">
          <div className="row g-2">
            <div className="col-md-6">
              <InputGroup size="sm">
                <InputGroup.Text className="bg-secondary text-light border-secondary">
                  <i className="bi bi-search"></i>
                </InputGroup.Text>
                <Form.Control
                  type="text"
                  placeholder="Search logs..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="bg-dark text-light border-secondary"
                />
              </InputGroup>
            </div>
            <div className="col-md-3">
              <Form.Select
                size="sm"
                value={levelFilter}
                onChange={(e) => setLevelFilter(e.target.value)}
                className="bg-dark text-light border-secondary"
              >
                <option value="all">All Levels</option>
                <option value="error">Error</option>
                <option value="warn">Warning</option>
                <option value="info">Info</option>
                <option value="debug">Debug</option>
              </Form.Select>
            </div>
            <div className="col-md-3">
              <div className="d-flex gap-2">
                <Button
                  variant="outline-primary"
                  size="sm"
                  onClick={loadLogs}
                  disabled={loading}
                >
                  <i className="bi bi-arrow-clockwise me-1"></i>
                  Refresh
                </Button>
                <Form.Check
                  type="switch"
                  id="auto-scroll"
                  label="Auto-scroll"
                  checked={autoScroll}
                  onChange={(e) => setAutoScroll(e.target.checked)}
                  className="text-light"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Logs Container */}
        <div 
          ref={logsContainerRef}
          className="logs-container"
          style={{ 
            height: '60vh', 
            overflowY: 'auto',
            fontFamily: 'Monaco, Consolas, "Courier New", monospace',
            fontSize: '0.85rem'
          }}
          onScroll={handleScroll}
        >
          {loading && logs.length === 0 ? (
            <div className="text-center py-5">
              <div className="spinner-border text-primary" role="status">
                <span className="visually-hidden">Loading...</span>
              </div>
              <div className="mt-2">Loading logs...</div>
            </div>
          ) : filteredLogs.length > 0 ? (
            <div className="p-3">
              {/* Load More Button */}
              {logs.length >= 100 && (
                <div className="text-center mb-3">
                  <Button
                    variant="outline-secondary"
                    size="sm"
                    onClick={loadMoreLogs}
                    disabled={loading}
                  >
                    {loading ? (
                      <>
                        <div className="spinner-border spinner-border-sm me-2" role="status">
                          <span className="visually-hidden">Loading...</span>
                        </div>
                        Loading...
                      </>
                    ) : (
                      <>
                        <i className="bi bi-arrow-up me-1"></i>
                        Load More Logs
                      </>
                    )}
                  </Button>
                </div>
              )}

              {/* Log Entries */}
              {filteredLogs.map((log, index) => (
                <div 
                  key={index}
                  className={`log-entry p-2 mb-1 rounded border-start border-2 ${
                    log.level?.toLowerCase() === 'error' || log.level?.toLowerCase() === 'fatal' 
                      ? 'bg-danger bg-opacity-10 border-danger' 
                      : log.level?.toLowerCase() === 'warn' || log.level?.toLowerCase() === 'warning'
                      ? 'bg-warning bg-opacity-10 border-warning'
                      : 'bg-success bg-opacity-10 border-success'
                  }`}
                  style={{
                    wordBreak: 'break-word',
                    whiteSpace: 'pre-wrap'
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
                  {log.service && (
                    <small className="text-muted">
                      Service: {log.service}
                    </small>
                  )}
                </div>
              ))}
              <div ref={logsEndRef} />
            </div>
          ) : (
            <div className="text-center text-muted py-5">
              <i className="bi bi-journal-x fs-1"></i>
              <div className="mt-2">
                {searchTerm || levelFilter !== 'all' 
                  ? 'No logs match your filters' 
                  : 'No logs available'
                }
              </div>
            </div>
          )}
        </div>
      </Modal.Body>
      
      <Modal.Footer className="bg-dark border-secondary">
        <div className="d-flex justify-content-between w-100 align-items-center">
          <small className="text-muted">
            Showing {filteredLogs.length} of {logs.length} log entries
          </small>
          <Button variant="secondary" onClick={onHide}>
            Close
          </Button>
        </div>
      </Modal.Footer>
    </Modal>
  );
};

export default LogsModal;
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Modal, Button, Badge, Row, Col, Form, InputGroup } from 'react-bootstrap';
import { FaCircle, FaSearch, FaSync } from 'react-icons/fa';
import { LogEntry } from '../types/logs';
import { useLogMessages } from '../hooks/useLogMessages';

// Type the icons to resolve TypeScript issues
const CircleIcon = FaCircle as React.ComponentType<{ size?: number; className?: string }>;
const SearchIcon = FaSearch as React.ComponentType<{ className?: string }>;
const SyncIcon = FaSync as React.ComponentType<{ className?: string }>;

interface LogsModalProps {
  show: boolean;
  onHide: () => void;
  containerId: string;
  containerName: string;
}

// Constants for memory management
const SCROLL_THRESHOLD = 50;

const LogsModal: React.FC<LogsModalProps> = ({
  show,
  onHide,
  containerId,
  containerName
}) => {
  // Get logs and connection status from custom hook
  const { 
    logs, 
    cleanup: cleanupLogs, 
    isConnected: isContainerConnected,
    isConnecting 
  } = useLogMessages(containerId);
  
  // State management
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  
  // Refs for DOM elements
  const logsEndRef = useRef<HTMLDivElement>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);
  
    // Auto-scroll to bottom when new logs arrive, with performance optimization
  useEffect(() => {
    if (autoScroll && logsEndRef.current && logs.length > 0) {
      // Use requestAnimationFrame for smoother scrolling
      const rafId = requestAnimationFrame(() => {
        const scrollOptions = { behavior: logs.length > 100 ? 'auto' : 'smooth' as ScrollBehavior };
        logsEndRef.current?.scrollIntoView(scrollOptions);
      });
      
      return () => cancelAnimationFrame(rafId);
    }
  }, [logs.length, autoScroll]);
  
  // Handle scroll events to manage auto-scroll
  const handleScroll = useCallback(() => {
    if (!logsContainerRef.current) return;
    
    const { scrollTop, scrollHeight, clientHeight } = logsContainerRef.current;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < SCROLL_THRESHOLD;
    
    setAutoScroll(prev => prev !== isNearBottom ? isNearBottom : prev);
  }, []);

  // Throttled scroll handler
  const throttledScrollHandler = useMemo(() => {
    let timeoutId: NodeJS.Timeout | null = null;
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(handleScroll, 50);
    };
  }, [handleScroll]);
  
  // Filter logs based on search term and level
  const filteredLogs = useMemo(() => {
    if (!searchTerm.trim() && levelFilter === 'all') {
      return logs;
    }
    
    const searchTermLower = searchTerm.toLowerCase().trim();
    
    return logs.filter(log => {
      if (levelFilter !== 'all' && log.level !== levelFilter) {
        return false;
      }
      
      if (searchTermLower && !log.message?.toLowerCase().includes(searchTermLower)) {
        return false;
      }
      
      return true;
    });
  }, [logs, searchTerm, levelFilter]);

  // Get log level color
  const getLogLevelColor = useCallback((level: string) => {
    switch (level) {
      case 'error': return '#dc3545';
      case 'warn': return '#ffc107';
      case 'debug': return '#6c757d';
      case 'info':
      default: return '#0d6efd';
    }
  }, []);

  // Handle clear logs
  const handleClearLogs = useCallback(() => {
    cleanupLogs();
    setLastUpdated(new Date());
  }, [cleanupLogs]);

  // Handle modal close
  const handleClose = useCallback(() => {
    onHide();
    cleanupLogs();
  }, [onHide, cleanupLogs]);

  // Memoized log rendering
  const renderedLogs = useMemo(() => {
    return filteredLogs.map((log, index) => (
      <div 
        key={`${log.timestamp}-${index}`}
        className={`log-entry log-${log.level || 'info'}`}
        style={{
          padding: '4px 8px',
          borderLeft: `3px solid ${getLogLevelColor(log.level || 'info')}`,
          marginBottom: '2px',
          fontSize: '0.875rem',
          fontFamily: 'monospace',
          backgroundColor: index % 2 === 0 ? '#ffffff' : '#f8f9fa'
        }}
      >
        <span style={{ color: '#6c757d', marginRight: '8px' }}>
          {new Date(log.timestamp).toLocaleTimeString()}
        </span>
        <span style={{ 
          color: getLogLevelColor(log.level || 'info'),
          fontWeight: 'bold',
          marginRight: '8px'
        }}>
          [{(log.level || 'info').toUpperCase()}]
        </span>
        <span>{log.message}</span>
      </div>
    ));
  }, [filteredLogs, getLogLevelColor]);

  // Handle modal visibility
  useEffect(() => {
    if (!show) {
      cleanupLogs();
    }
  }, [show, cleanupLogs]);

  return (
    <Modal show={show} onHide={handleClose} size="lg" centered>
      <Modal.Header closeButton>
        <Modal.Title>
          Logs: {containerName}
          <Badge 
            bg={isContainerConnected ? 'success' : 'danger'}
            className="ms-2"
          >
            <CircleIcon size={10} className="me-1" />
            {isContainerConnected ? 'Connected' : 'Disconnected'}
          </Badge>
        </Modal.Title>
      </Modal.Header>
      <Modal.Body style={{ padding: '1rem', backgroundColor: '#f5f5f5' }}>
        <Row className="mb-3">
          <Col md={8}>
            <InputGroup>
              <InputGroup.Text><SearchIcon /></InputGroup.Text>
              <Form.Control
                type="text"
                placeholder="Search logs..."
                value={searchTerm}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => 
                  setSearchTerm(e.target.value)
                }
                disabled={isConnecting || !isContainerConnected}
              />
            </InputGroup>
          </Col>
          <Col md={4}>
            <Form.Select 
              value={levelFilter}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => 
                setLevelFilter(e.target.value)
              }
              disabled={isConnecting || !isContainerConnected}
            >
              <option value="all">All Levels</option>
              <option value="info">Info</option>
              <option value="warn">Warning</option>
              <option value="error">Error</option>
              <option value="debug">Debug</option>
            </Form.Select>
          </Col>
        </Row>
        
        <div 
          ref={logsContainerRef}
          className="logs-container"
          onScroll={throttledScrollHandler}
          style={{ 
            height: '60vh', 
            overflowY: 'auto',
            border: '1px solid #dee2e6',
            borderRadius: '0.25rem',
            padding: '0.5rem',
            backgroundColor: '#ffffff'
          }}
        >
          {isConnecting ? (
            <div className="text-center my-4">
              <SyncIcon className="fa-spin me-2" />
              Loading logs...
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="text-muted text-center my-4">
              {logs.length === 0 ? (
                isContainerConnected ? 
                  'No logs available yet. Logs will appear here when generated.' :
                  'Not connected to container. Check container status.'
              ) : (
                'No logs match current filters'
              )}
            </div>
          ) : (
            <>
              {renderedLogs}
              <div ref={logsEndRef} />
            </>
          )}
        </div>
      </Modal.Body>
      <Modal.Footer className="d-flex justify-content-between">
        <div className="d-flex align-items-center">
          <Form.Check
            type="switch"
            id="auto-scroll-switch"
            label="Auto-scroll"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            className="me-3"
          />
          <Button
            variant="outline-secondary"
            size="sm"
            onClick={handleClearLogs}
            className="me-3"
            disabled={logs.length === 0}
          >
            Clear Logs
          </Button>
          <small className="text-muted">
            {filteredLogs.length !== logs.length ? 
              `Showing ${filteredLogs.length} of ${logs.length} logs` :
              `${logs.length} log${logs.length !== 1 ? 's' : ''}`
            }
          </small>
        </div>
        <div className="d-flex align-items-center gap-2">
          <small className="text-muted">
            Last updated: {lastUpdated.toLocaleTimeString()}
          </small>
          <Button variant="secondary" onClick={handleClose}>
            Close
          </Button>
        </div>
      </Modal.Footer>
    </Modal>
  );
};

export default LogsModal;

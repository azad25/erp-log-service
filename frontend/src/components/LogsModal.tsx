import * as React from 'react';
import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Modal, Button, Badge, Row, Col, Form, InputGroup, Spinner, Alert } from 'react-bootstrap';
import { FaCircle, FaSearch, FaSync, FaExclamationTriangle } from 'react-icons/fa';
import { ToastContainer, toast } from 'react-toastify';
import AutoSizer from 'react-virtualized-auto-sizer';
import 'react-toastify/dist/ReactToastify.css';
import { LogEntry } from '../types/logs';
import { useLogMessages } from '../hooks/useLogMessages';
import { useWebSocket } from '../contexts/WebSocketContext';

const { FixedSizeList } = require('react-window');

interface ListItemProps {
  index: number;
  style: React.CSSProperties;
  data: LogEntry[];
}

const SCROLL_THRESHOLD = 50;
const LOG_ITEM_HEIGHT = 40;
const VISIBLE_LOGS = 100;

const CircleIcon = FaCircle as React.ComponentType<{ size?: number; className?: string }>;
const SearchIcon = FaSearch as React.ComponentType<{ className?: string }>;
const SyncIcon = FaSync as React.ComponentType<{ className?: string }>;
const ExclamationTriangleIcon = FaExclamationTriangle as React.ComponentType<{ className?: string; size?: number }>;

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
  const { logs, cleanup: cleanupLogs, isConnected: isContainerConnected, isConnecting, error: logError } = useLogMessages(containerId && containerId !== 'all' ? containerId : '', VISIBLE_LOGS);
  const { connect, disconnect } = useWebSocket();
  const [searchTerm, setSearchTerm] = useState('');
  const [levelFilter, setLevelFilter] = useState('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const logsEndRef = useRef<HTMLDivElement>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll && logsEndRef.current && logs.length > 0) {
      // Use a timeout to prevent infinite scrolling loops
      const timeoutId = setTimeout(() => {
        logsEndRef.current?.scrollIntoView({ behavior: 'auto' });
      }, 50);
      return () => clearTimeout(timeoutId);
    }
  }, [logs.length, autoScroll]);

  const handleScroll = useCallback(() => {
    if (!logsContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = logsContainerRef.current;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < SCROLL_THRESHOLD;
    setAutoScroll(isNearBottom);
  }, []);

  const filteredLogs = useMemo(() => {
    if (!searchTerm.trim() && levelFilter === 'all') return logs;
    const searchTermLower = searchTerm.toLowerCase().trim();
    return logs.filter(log => {
      if (levelFilter !== 'all' && log.level !== levelFilter) return false;
      if (searchTermLower && !log.message?.toLowerCase().includes(searchTermLower)) return false;
      return true;
    });
  }, [logs, searchTerm, levelFilter]);

  const getLogLevelColor = (level: string) => {
    switch (level) {
      case 'error': return '#dc3545';
      case 'warn': return '#ffc107';
      case 'debug': return '#6c757d';
      case 'info':
      default: return '#0d6efd';
    }
  };

  const handleClearLogs = useCallback(() => {
    try {
      cleanupLogs();
      setLastUpdated(new Date());
      toast.success('Logs cleared successfully');
    } catch (err) {
      console.error('Error clearing logs:', err);
      toast.error('Failed to clear logs');
    }
  }, [cleanupLogs]);

  const handleClose = useCallback(() => {
    try {
      if (containerId && containerId !== 'all') {
        disconnect(containerId);
      }
      onHide();
      cleanupLogs();
    } catch (err) {
      console.error('Error closing log modal:', err);
      onHide();
    }
  }, [onHide, cleanupLogs, containerId, disconnect]);

  useEffect(() => {
    if (!show) {
      cleanupLogs();
      if (containerId && containerId !== 'all') {
        disconnect(containerId);
      }
    } else {
      if (containerId && containerId !== 'all') {
        connect(containerId);
      }
      if (logsContainerRef.current) {
        logsContainerRef.current.scrollTop = 0;
        setAutoScroll(true);
      }
    }
  }, [show, containerId, cleanupLogs, connect, disconnect]);

  const LogRow: React.FC<ListItemProps> = ({ index, style, data }) => {
    if (!data) return null;
    const log = data[index];
    if (!log) return null;
    return (
      <div style={style} className={`log-entry log-${log.level || 'info'} d-flex align-items-center px-2`}>
        <span className="text-muted small me-2" style={{ minWidth: '160px' }}>{new Date(log.timestamp).toLocaleString()}</span>
        <span className="text-uppercase small fw-bold me-2" style={{ minWidth: '60px', color: getLogLevelColor(log.level) }}>{log.level || 'info'}</span>
        <span className="log-message text-truncate">{log.message}</span>
      </div>
    );
  };

  const renderLoadingState = () => (
    <Modal show={show && isConnecting} onHide={onHide} size="lg" centered>
      <Modal.Header closeButton>
        <Modal.Title>Loading Logs...</Modal.Title>
      </Modal.Header>
      <Modal.Body className="d-flex justify-content-center align-items-center" style={{ minHeight: '200px' }}>
        <Spinner animation="border" role="status">
          <span className="visually-hidden">Loading...</span>
        </Spinner>
      </Modal.Body>
    </Modal>
  );

  const renderErrorState = () => (
    <Modal show={show && !!logError} onHide={onHide} size="lg" centered>
      <Modal.Header closeButton>
        <Modal.Title>Error Loading Logs</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Alert variant="danger">
          <p>Failed to load logs for {containerName}.</p>
          <p className="mb-0">Error: {logError?.message}</p>
        </Alert>
        <div className="d-flex justify-content-end">
          <Button variant="secondary" onClick={onHide} className="me-2">Close</Button>
          <Button variant="primary" onClick={() => window.location.reload()}>Retry</Button>
        </div>
      </Modal.Body>
    </Modal>
  );

  if (isConnecting) return renderLoadingState();
  if (logError) return renderErrorState();

  return (
    <Modal show={show} onHide={handleClose} size="xl" fullscreen="md-down" className="log-modal">
      <Modal.Header closeButton>
        <Modal.Title className="d-flex align-items-center">
          <span>Logs: {containerName}</span>
          <Badge 
            bg={isContainerConnected ? 'success' : isConnecting ? 'warning' : 'danger'}
            className="ms-2 d-flex align-items-center"
          >
            <CircleIcon size={10} className="me-1" />
            {isContainerConnected ? 'Connected' : isConnecting ? 'Connecting...' : 'Disconnected'}
            {!isContainerConnected && !isConnecting && (
              <ExclamationTriangleIcon className="ms-1" size={10} />
            )}
          </Badge>
        </Modal.Title>
      </Modal.Header>
      <Modal.Body style={{ padding: '1rem', backgroundColor: '#f5f5f5', display: 'flex', flexDirection: 'column', height: '70vh' }}>
        <Row className="mb-3">
          <Col md={8}>
            <InputGroup>
              <InputGroup.Text><SearchIcon /></InputGroup.Text>
              <Form.Control
                type="text"
                placeholder="Search logs..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </InputGroup>
          </Col>
          <Col md={4}>
            <Form.Select
              value={levelFilter}
              onChange={(e) => setLevelFilter(e.target.value)}
            >
              <option value="all">All Levels</option>
              <option value="info">Info</option>
              <option value="warn">Warning</option>
              <option value="error">Error</option>
              <option value="debug">Debug</option>
            </Form.Select>
          </Col>
        </Row>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <div className="bg-white rounded border border-light flex-grow-1" ref={logsContainerRef} onScroll={handleScroll} style={{ overflowY: 'auto' }}>
            {filteredLogs.length > 0 ? (
              <AutoSizer>
                {({ height, width }: { height: number; width: number }) => (
                  <FixedSizeList
                    height={height}
                    itemCount={filteredLogs.length}
                    itemSize={LOG_ITEM_HEIGHT}
                    width={width}
                    overscanCount={10}
                    itemData={filteredLogs}
                    itemKey={(index: number) => filteredLogs[index]?.timestamp || index.toString()}
                  >
                    {LogRow}
                  </FixedSizeList>
                )}
              </AutoSizer>
            ) : (
              <div className="d-flex justify-content-center align-items-center h-100">
                <p className="text-muted mb-0">No logs available</p>
              </div>
            )}
            <div ref={logsEndRef} />
          </div>
          <div className="d-flex justify-content-between align-items-center mt-2">
            <small className="text-muted">
              Showing {filteredLogs.length} of {logs.length} logs
            </small>
            <Button
              variant="outline-secondary"
              size="sm"
              onClick={handleClearLogs}
              disabled={!logs.length || isConnecting || !isContainerConnected}
            >
              <SyncIcon className="me-1" /> Clear Logs
            </Button>
          </div>
        </div>
      </Modal.Body>
      <Modal.Footer className="d-flex justify-content-between align-items-center">
        <Form.Check
          type="switch"
          id="auto-scroll-switch"
          label="Auto-scroll"
          checked={autoScroll}
          onChange={(e) => setAutoScroll(e.target.checked)}
        />
        <small className="text-muted">
          Last updated: {lastUpdated.toLocaleTimeString()}
        </small>
      </Modal.Footer>
      <ToastContainer 
        position="bottom-right"
        autoClose={3000}
        hideProgressBar
        newestOnTop
        closeOnClick
        rtl={false}
        pauseOnFocusLoss
        draggable
        pauseOnHover
      />
    </Modal>
  );
};

export default LogsModal;

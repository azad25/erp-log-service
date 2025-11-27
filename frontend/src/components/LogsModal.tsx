import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Modal, Button, Badge, Row, Col, Form, InputGroup, Spinner, Alert, OverlayTrigger, Tooltip } from 'react-bootstrap';
import { FaCircle, FaSearch, FaSync, FaExclamationTriangle } from 'react-icons/fa';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { useLogMessages } from '../hooks/useLogMessages';

const SCROLL_THRESHOLD = 100; // Pixels from bottom to trigger auto-scroll

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
  const { logs, cleanup: cleanupLogs, isConnected: isContainerConnected, isConnecting, error: logError, loadMoreLogs, isLoadingMore, hasMoreLogs, disconnect } = useLogMessages(containerId && containerId !== 'all' ? containerId : '', 25);
  const [searchTerm, setSearchTerm] = useState('');
  const [levelFilter, setLevelFilter] = useState('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll && logsEndRef.current && logs.length > 0) {
      // Use a timeout to prevent infinite scrolling loops
      const timeoutId = setTimeout(() => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
      return () => clearTimeout(timeoutId);
    }
  }, [logs.length, autoScroll]);

  // Update last updated time when new logs arrive
  useEffect(() => {
    if (logs.length > 0) {
      setLastUpdated(new Date());
    }
  }, [logs.length]);

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

  // Cleanup on unmount
  useEffect(() => {
    // Only cleanup when component is actually unmounting
    if (containerId && containerId !== 'all') {
      // Use a small delay to handle quick reopens
      const timer = setTimeout(() => {
        disconnect(containerId);
      }, 1000);
      
      return () => {
        clearTimeout(timer);
      };
    }
    
    // Return an empty cleanup function if no cleanup is needed
    return () => {};
  }, [disconnect, containerId]);

  const handleClose = useCallback(() => {
    try {
      onHide();
    } catch (err) {
      // Silent error handling
      onHide();
    }
  }, [onHide]);

  useEffect(() => {
    if (show) {
      // Modal opened - reset scroll and auto-scroll
      if (logsContainerRef.current) {
        logsContainerRef.current.scrollTop = 0;
        setAutoScroll(true);
      }
    }
  }, [show, containerId]);

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

  // Copy log to clipboard
  const copyToClipboard = useCallback(async (text: string, index: number) => {
    try {
      // Try modern clipboard API first
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        setCopiedIndex(index);
        toast.success('Log copied to clipboard!', { autoClose: 1500 });
        setTimeout(() => setCopiedIndex(null), 2000);
      } else {
        // Fallback for non-secure contexts (HTTP)
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        
        try {
          const successful = document.execCommand('copy');
          if (successful) {
            setCopiedIndex(index);
            toast.success('Log copied to clipboard!', { autoClose: 1500 });
            setTimeout(() => setCopiedIndex(null), 2000);
          } else {
            throw new Error('Copy command failed');
          }
        } finally {
          document.body.removeChild(textArea);
        }
      }
    } catch (err) {
      console.error('Failed to copy:', err);
      toast.error('Failed to copy to clipboard. Please try again.');
    }
  }, []);

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
              <div>
                {/* Load more button at the top for older logs */}
                {hasMoreLogs && (
                  <div className="text-center p-3 border-bottom bg-light">
                    <button
                      className="btn btn-outline-primary btn-sm"
                      onClick={async () => {
                        const scrollContainer = logsContainerRef.current;
                        const scrollHeightBefore = scrollContainer?.scrollHeight || 0;
                        
                        await loadMoreLogs();
                        
                        // Maintain scroll position after loading more logs
                        if (scrollContainer) {
                          const scrollHeightAfter = scrollContainer.scrollHeight;
                          const heightDiff = scrollHeightAfter - scrollHeightBefore;
                          scrollContainer.scrollTop += heightDiff;
                        }
                      }}
                      disabled={isLoadingMore || isConnecting || !isContainerConnected}
                    >
                      {isLoadingMore ? (
                        <>
                          <span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>
                          Loading older logs...
                        </>
                      ) : (
                        <>
                          <i className="bi bi-arrow-up me-1"></i>
                          Load More (Older)
                        </>
                      )}
                    </button>
                  </div>
                )}
                <div style={{ height: '400px', overflowY: 'auto' }}>
                  {filteredLogs.map((log, index) => {
                    const logText = `[${formatTime(log.timestamp)}] [${log.level || 'INFO'}] ${log.message || log.raw}`;
                    
                    return (
                      <div 
                        key={`${log.container_id}-${log.timestamp}-${index}`}
                        className={`log-entry p-2 mb-2 rounded border-start border-3 position-relative ${
                          log.level?.toLowerCase() === 'error' || log.level?.toLowerCase() === 'fatal' 
                            ? 'bg-danger bg-opacity-10 border-danger' 
                            : 'bg-success bg-opacity-10 border-success'
                        }`}
                        style={{
                          animation: `slideIn 0.3s ease-out ${index * 0.05}s both`
                        }}
                      >
                        <div className="d-flex justify-content-between align-items-start mb-1">
                          <div className="d-flex align-items-center">
                            <Badge 
                              bg={getLogLevelColor(log.level || 'info')} 
                              className="me-2" 
                            >
                              {log.level || 'INFO'}
                            </Badge>
                            <small className="text-muted">
                              {formatTime(log.timestamp)}
                            </small>
                          </div>
                          <OverlayTrigger
                            placement="left"
                            overlay={
                              <Tooltip id={`tooltip-modal-${index}`}>
                                {copiedIndex === index ? 'Copied!' : 'Copy to clipboard'}
                              </Tooltip>
                            }
                          >
                            <button
                              className="btn btn-sm btn-link text-muted p-0"
                              onClick={() => copyToClipboard(logText, index)}
                              style={{ 
                                fontSize: '0.9rem',
                                opacity: 0.6,
                                transition: 'opacity 0.2s'
                              }}
                              onMouseEnter={(e) => e.currentTarget.style.opacity = '1'}
                              onMouseLeave={(e) => e.currentTarget.style.opacity = '0.6'}
                            >
                              <i className={copiedIndex === index ? 'bi bi-check2' : 'bi bi-clipboard'}></i>
                            </button>
                          </OverlayTrigger>
                        </div>
                        <div className="log-message">
                          <code style={{ fontSize: '0.85em', wordBreak: 'break-word' }}>
                            {log.message || log.raw}
                          </code>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
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
            <div className="d-flex gap-2">
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

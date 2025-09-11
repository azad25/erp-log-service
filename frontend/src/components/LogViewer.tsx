import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { useLogMessages } from '../hooks/useLogMessages';
import { Button, Spinner } from 'react-bootstrap';

interface LogViewerProps {
  selectedContainer: string;
  onFilterChange?: (filter: { level: string; search: string }) => void;
}

const LogViewer: React.FC<LogViewerProps> = ({
  selectedContainer,
  onFilterChange,
}) => {
  // Use WebSocket hook for real-time logs
  const { logs, isConnected, isConnecting, cleanup, loadMoreLogs, isLoadingMore, hasMoreLogs } = useLogMessages(
    selectedContainer && selectedContainer !== 'all' ? selectedContainer : '', 
    25  // Limit to 25 logs maximum for better UX
  );
  const isLoading = isConnecting;
  const endOfLogsRef = useRef<HTMLDivElement>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [showTimestamps, setShowTimestamps] = useState(true);
  const [filter, setFilter] = useState('');
  const [selectedLogLevel, setSelectedLogLevel] = useState('all');
  const [isAtBottom, setIsAtBottom] = useState(true);

  // Handle scroll events to detect if user is at bottom
  const handleScroll = useCallback(() => {
    if (!logContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = logContainerRef.current;
    const isBottom = scrollHeight - scrollTop <= clientHeight + 50; // 50px threshold
    setIsAtBottom(isBottom);
    
    // If user scrolls to bottom, re-enable auto-scroll
    if (isBottom) {
      setAutoScroll(true);
    } else if (autoScroll) {
      setAutoScroll(false);
    }
  }, [autoScroll]);

  // Auto-scroll to bottom when new logs arrive and autoScroll is true
  useEffect(() => {
    if (autoScroll && isAtBottom && endOfLogsRef.current) {
      endOfLogsRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll, isAtBottom]);

  // Add scroll event listener
  const handleLoadMore = () => {
    // Load more logs requested
    loadMoreLogs();
  };

  useEffect(() => {
    const container = logContainerRef.current;
    if (container) {
      container.addEventListener('scroll', handleScroll);
      return () => container.removeEventListener('scroll', handleScroll);
    }
  }, [handleScroll]);

  // Auto-scroll to bottom on initial load
  useEffect(() => {
    if (endOfLogsRef.current) {
      endOfLogsRef.current.scrollIntoView();
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  const formatTimestamp = (timestamp: string) => {
    try {
      const date = new Date(timestamp);
      return date.toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    } catch {
      return timestamp;
    }
  };

  const formatLogLevel = (level: string) => {
    return level?.toUpperCase() || 'INFO';
  };

  const getLogLevelBadge = (level: string) => {
    const levelLower = level?.toLowerCase() || 'info';
    const badgeClasses = {
      error: 'bg-danger',
      err: 'bg-danger',
      warn: 'bg-warning text-dark',
      warning: 'bg-warning text-dark',
      info: 'bg-success',
      debug: 'bg-secondary',
      trace: 'bg-light text-dark',
      fatal: 'bg-danger',
      critical: 'bg-danger'
    };
    
    return badgeClasses[levelLower as keyof typeof badgeClasses] || 'bg-secondary';
  };

  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      const message = log.message || '';
      const level = log.level || '';
      const matchesFilter = !filter || message.toLowerCase().includes(filter.toLowerCase());
      const matchesLevel = selectedLogLevel === 'all' || 
        level.toLowerCase() === selectedLogLevel.toLowerCase();
      return matchesFilter && matchesLevel;
    });
  }, [logs, filter, selectedLogLevel]);

  // Notify parent component of filter changes
  useEffect(() => {
    if (onFilterChange) {
      onFilterChange({
        level: selectedLogLevel,
        search: filter
      });
    }
  }, [selectedLogLevel, filter, onFilterChange]);

  const logLevels = useMemo(() => {
    const levels = new Set(logs.map(log => log.level?.toLowerCase()).filter(Boolean));
    return Array.from(levels).sort();
  }, [logs]);

  if (isLoading && logs.length === 0) {
    return (
      <div className="d-flex justify-content-center align-items-center h-100">
        <div className="text-center">
          <div className="spinner-border text-primary mb-3" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
          <p className="text-muted">Loading logs for {selectedContainer}...</p>
        </div>
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="d-flex justify-content-center align-items-center h-100">
        <div className="text-center">
          <i className="bi bi-file-text display-1 text-muted mb-3"></i>
          <h5 className="text-muted">
            {selectedContainer === 'all' 
              ? 'No logs available. Select a container to view its logs.'
              : 'No logs available for this container.'}
          </h5>
          {!isConnected && (
            <p className="text-warning">
              <i className="bi bi-exclamation-triangle me-1"></i>
              WebSocket disconnected. Logs may not update in real-time.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="log-viewer-container d-flex flex-column h-100">
      {/* Log Viewer Header with Controls */}
      <div className="log-viewer-header bg-secondary p-3 border-bottom border-dark flex-shrink-0">
        <div className="d-flex justify-content-between align-items-center mb-2">
          <h6 className="mb-0 text-light">
            <i className="bi bi-file-text me-2"></i>
            {selectedContainer === 'all' ? 'All Containers' : selectedContainer.replace('erp-suite-', '')}
          </h6>
          <div className="d-flex align-items-center gap-2">
            {isConnected ? (
              <span className="badge bg-success">
                <i className="bi bi-wifi me-1"></i>
                Live
              </span>
            ) : (
              <span className="badge bg-warning">
                <i className="bi bi-wifi-off me-1"></i>
                Disconnected
              </span>
            )}
            <span className="badge bg-info">
              {filteredLogs.length} entries
            </span>
          </div>
        </div>
        <div className="row g-2">
          <div className="col-md-4">
            <div className="input-group input-group-sm">
              <span className="input-group-text bg-dark text-light border-secondary">
                <i className="bi bi-search"></i>
              </span>
              <input
                type="text"
                className="form-control bg-dark text-light border-secondary"
                placeholder="Filter logs..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
          </div>
          <div className="col-md-2">
            <select
              className="form-select form-select-sm bg-dark text-light border-secondary"
              value={selectedLogLevel}
              onChange={(e) => setSelectedLogLevel(e.target.value)}
            >
              <option value="all">All Levels</option>
              {logLevels.map(level => (
                <option key={level} value={level}>
                  {formatLogLevel(level)}
                </option>
              ))}
            </select>
          </div>
          <div className="col-md-3">
            <div className="form-check form-switch">
              <input
                className="form-check-input"
                type="checkbox"
                id="autoScroll"
                checked={autoScroll}
                onChange={(e) => setAutoScroll(e.target.checked)}
              />
              <label className="form-check-label small text-light" htmlFor="autoScroll">
                Auto-scroll
              </label>
            </div>
          </div>
          <div className="col-md-3">
            <div className="form-check form-switch">
              <input
                className="form-check-input"
                type="checkbox"
                id="showTimestamps"
                checked={showTimestamps}
                onChange={(e) => setShowTimestamps(e.target.checked)}
              />
              <label className="form-check-label small text-light" htmlFor="showTimestamps">
                Timestamps
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* Log Content */}
      <div 
        className="log-content flex-grow-1 overflow-auto p-3"
        style={{ 
          backgroundColor: '#1a1a1a',
          fontFamily: 'Monaco, Consolas, "Courier New", monospace',
          fontSize: '0.85rem'
        }}
        ref={logContainerRef}
      >
        {filteredLogs.length === 0 ? (
          <div className="d-flex justify-content-center align-items-center h-100">
            <div className="text-center text-muted">
              <i className="bi bi-journal-x display-1 mb-3"></i>
              <h5>No logs available</h5>
              {filter && <p>Try adjusting your filter</p>}
              {selectedLogLevel !== 'all' && <p>Try changing the log level filter</p>}
              {selectedContainer === 'all' && <p>Select a container to view its logs</p>}
            </div>
          </div>
        ) : (
          <div className="log-entries">
            {/* Show load more button at the top for older logs */}
            {hasMoreLogs && (
              <Button 
                variant="outline-secondary" 
                size="sm" 
                onClick={handleLoadMore}
                disabled={isLoadingMore}
                className="mb-2 w-100"
              >
                {isLoadingMore ? (
                  <>
                    <Spinner size="sm" className="me-2" />
                    Loading...
                  </>
                ) : (
                  'Load More (Older)'
                )}
              </Button>
            )}
            {filteredLogs.map((log, index) => {
              const isError = log.level?.toLowerCase() === 'error' || log.level?.toLowerCase() === 'fatal';
              const isWarning = log.level?.toLowerCase() === 'warn' || log.level?.toLowerCase() === 'warning';
              
              return (
                <div
                  key={`${log.timestamp}-${index}`}
                  className={`log-entry p-2 mb-2 rounded border-start border-3 ${
                    isError 
                      ? 'bg-danger bg-opacity-10 border-danger' 
                      : isWarning 
                      ? 'bg-warning bg-opacity-10 border-warning'
                      : 'bg-success bg-opacity-10 border-success'
                  }`}
                  style={{
                    lineHeight: '1.4',
                    wordBreak: 'break-word'
                  }}
                >
                  <div className="d-flex align-items-start">
                    {showTimestamps && (
                      <span 
                        className="text-muted me-2 flex-shrink-0" 
                        style={{ minWidth: '80px', fontSize: '0.75rem' }}
                      >
                        {formatTimestamp(log.timestamp)}
                      </span>
                    )}
                    {log.level && (
                      <span 
                        className={`badge ${getLogLevelBadge(log.level)} me-2 flex-shrink-0`} 
                        style={{ fontSize: '0.7rem' }}
                      >
                        {formatLogLevel(log.level)}
                      </span>
                    )}
                    {log.container && selectedContainer === 'all' && (
                      <span 
                        className="badge bg-secondary text-light me-2 flex-shrink-0" 
                        style={{ fontSize: '0.7rem' }}
                      >
                        {log.container.replace('erp-suite-', '')}
                      </span>
                    )}
                    <span className="text-light flex-grow-1">
                      {log.message || log.raw}
                    </span>
                  </div>
                </div>
              );
            })}
            <div ref={endOfLogsRef} />
          </div>
        )}
      </div>
    </div>
  );
};

export default LogViewer;

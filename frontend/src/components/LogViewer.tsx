import React, { useEffect, useRef, useState, useMemo } from 'react';
import { LogEntry } from '../types/logs';
import { formatTimestamp, formatLogLevel, getLogLevelColor } from '../services/api';

interface LogViewerProps {
  logs: LogEntry[];
  selectedContainer: string;
  isLoading: boolean;
  isConnected: boolean;
}

const LogViewer: React.FC<LogViewerProps> = ({ logs, selectedContainer, isLoading, isConnected }) => {
  const endOfLogsRef = useRef<HTMLDivElement>(null);
  const prevLogsLength = useRef(0);

  const [autoScroll, setAutoScroll] = useState(true);
  const [showTimestamps, setShowTimestamps] = useState(true);
  const [filter, setFilter] = useState('');
  const [selectedLogLevel, setSelectedLogLevel] = useState('all');

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && endOfLogsRef.current) {
      endOfLogsRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, autoScroll]);

  const getLogLevelBadge = (level: string) => {
    const levelLower = level?.toLowerCase() || 'info';
    const badgeClasses = {
      error: 'bg-danger',
      err: 'bg-danger',
      warn: 'bg-warning text-dark',
      warning: 'bg-warning text-dark',
      info: 'bg-info',
      debug: 'bg-secondary',
      trace: 'bg-light text-dark',
      fatal: 'bg-danger',
      critical: 'bg-danger'
    };
    
    return badgeClasses[levelLower as keyof typeof badgeClasses] || 'bg-secondary';
  };

  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      const matchesFilter = !filter || log.message.toLowerCase().includes(filter.toLowerCase());
      const matchesLevel = selectedLogLevel === 'all' || 
        (log.level && log.level.toLowerCase() === selectedLogLevel.toLowerCase());
      return matchesFilter && matchesLevel;
    });
  }, [logs, filter, selectedLogLevel]);

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

  const getLogEntryClass = (level: string, index: number) => {
    const baseClass = 'log-entry p-2 mb-1 rounded border-start border-3 slide-in';
    const isError = level === 'ERROR' || level === 'FATAL';
    const isWarning = level === 'WARN' || level === 'WARNING';
    
    let bgClass = 'bg-dark';
    let borderClass = 'border-secondary';
    
    if (isError) {
      bgClass = 'bg-danger bg-opacity-10';
      borderClass = 'border-danger';
    } else if (isWarning) {
      bgClass = 'bg-warning bg-opacity-10';
      borderClass = 'border-warning';
    } else {
      bgClass = 'bg-success bg-opacity-10';
      borderClass = 'border-success';
    }
    
    return `${baseClass} ${bgClass} ${borderClass}`;
  };

  return (
    <div 
      className="log-viewer h-100 overflow-auto p-2"
      style={{ 
        backgroundColor: '#1a1a1a',
        fontFamily: 'Monaco, "Lucida Console", monospace'
      }}
    >
      {!isConnected && (
        <div className="alert alert-warning mb-3" role="alert">
          <i className="bi bi-exclamation-triangle me-2"></i>
          WebSocket connection lost. Logs may not update in real-time.
        </div>
      )}
      
      {/* Header */}
      <div className="log-viewer-header bg-light p-3 border-bottom">
        <div className="d-flex justify-content-between align-items-center mb-2">
          <h6 className="mb-0">
            <i className="bi bi-file-text me-2"></i>
            Logs: {selectedContainer === 'all' ? 'All Containers' : selectedContainer}
          </h6>
          <div className="d-flex align-items-center gap-2">
            {!isConnected && (
              <span className="badge bg-warning">
                <i className="bi bi-wifi-off me-1"></i>
                Disconnected
              </span>
            )}
            {isConnected && (
              <span className="badge bg-success">
                <i className="bi bi-wifi me-1"></i>
                Live
              </span>
            )}
            <span className="badge bg-secondary">
              {filteredLogs.length} entries
            </span>
          </div>
        </div>

        {/* Controls */}
        <div className="row g-2">
          <div className="col-md-4">
            <div className="input-group input-group-sm">
              <span className="input-group-text">
                <i className="bi bi-search"></i>
              </span>
              <input
                type="text"
                className="form-control"
                placeholder="Filter logs..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
          </div>
          <div className="col-md-2">
            <select
              className="form-select form-select-sm"
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
              <label className="form-check-label small" htmlFor="autoScroll">
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
              <label className="form-check-label small" htmlFor="showTimestamps">
                Timestamps
              </label>
            </div>
          </div>
        </div>
      </div>

      {/* Log Content */}
      <div className="log-content flex-grow-1 overflow-auto p-3" style={{ backgroundColor: '#1e1e1e' }}>
        {filteredLogs.length === 0 ? (
          <div className="text-center text-muted py-5">
            <i className="bi bi-file-text display-4 mb-3"></i>
            <p>No logs available</p>
            {filter && <small>Try adjusting your filter</small>}
            {selectedLogLevel !== 'all' && <small>Try changing the log level filter</small>}
          </div>
        ) : (
          <div className="log-entries">
            {filteredLogs.map((log, index) => (
              <div
                key={`${log.timestamp}-${index}`}
                className="log-entry mb-1 p-2 rounded"
                style={{
                  backgroundColor: 'rgba(255, 255, 255, 0.05)',
                  borderLeft: `3px solid ${getLogLevelColor(log.level)}`,
                  fontFamily: 'Monaco, Consolas, "Lucida Console", monospace',
                  fontSize: '0.85rem',
                  lineHeight: '1.4'
                }}
              >
                <div className="d-flex align-items-start">
                  {showTimestamps && (
                    <span className="text-muted me-2" style={{ minWidth: '140px', fontSize: '0.75rem' }}>
                      {formatTimestamp(log.timestamp)}
                    </span>
                  )}
                  {log.level && (
                    <span className={`badge ${getLogLevelBadge(log.level)} me-2`} style={{ fontSize: '0.7rem' }}>
                      {formatLogLevel(log.level)}
                    </span>
                  )}
                  {log.container && selectedContainer === 'all' && (
                    <span className="badge bg-dark text-light me-2" style={{ fontSize: '0.7rem' }}>
                      {log.container}
                    </span>
                  )}
                  <span className="text-light flex-grow-1" style={{ wordBreak: 'break-word' }}>
                    {log.message}
                  </span>
                </div>
              </div>
            ))}
            <div ref={endOfLogsRef} />
          </div>
        )}
      </div>
    </div>
  );
};

export default LogViewer;

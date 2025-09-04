import React, { useEffect, useRef } from 'react';
import { LogEntry } from '../types/logs';
import { formatTimestamp, getLogLevelColor, formatLogLevel } from '../services/api';

interface LogViewerProps {
  logs: LogEntry[];
  selectedContainer: string;
  isLoading: boolean;
  isConnected: boolean;
}

const LogViewer: React.FC<LogViewerProps> = ({ logs, selectedContainer, isLoading, isConnected }) => {
  const endOfLogsRef = useRef<HTMLDivElement>(null);
  const prevLogsLength = useRef(0);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (endOfLogsRef.current && (logs.length !== prevLogsLength.current || prevLogsLength.current === 0)) {
      endOfLogsRef.current.scrollIntoView({ behavior: 'smooth' });
      prevLogsLength.current = logs.length;
    }
  }, [logs.length]);

  if (isLoading && logs.length === 0) {
    return (
      <div className="d-flex justify-content-center align-items-center h-100">
        <div className="text-center">
          <div className="spinner-border text-primary mb-3" role="status">
            <span className="visually-hidden">Loading...</span>
          </div>
          <p className="text-muted">Loading logs...</p>
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
      
      {logs.map((log, index) => (
        <div 
          key={`${log.timestamp}-${index}`}
          className={getLogEntryClass(log.level, index)}
          style={{
            animationDelay: `${index * 0.05}s`,
            transition: 'all 0.3s ease'
          }}
        >
          <div className="d-flex align-items-start">
            <span 
              className="text-muted me-3 font-monospace small"
              style={{ minWidth: '140px', fontSize: '0.75rem' }}
            >
              {formatTimestamp(log.timestamp)}
            </span>
            
            <span 
              className={`badge me-3 ${
                log.level === 'ERROR' || log.level === 'FATAL' ? 'bg-danger' :
                log.level === 'WARN' || log.level === 'WARNING' ? 'bg-warning text-dark' :
                log.level === 'INFO' ? 'bg-info' :
                'bg-secondary'
              }`}
              style={{ minWidth: '60px', fontSize: '0.65rem' }}
            >
              {formatLogLevel(log.level)}
            </span>
            
            {selectedContainer === 'all' && (
              <span 
                className="text-primary me-3 font-monospace small"
                style={{ 
                  minWidth: '120px', 
                  fontSize: '0.75rem',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
                title={log.container}
              >
                {log.container}
              </span>
            )}
            
            <pre 
              className="mb-0 text-light flex-grow-1"
              style={{
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontSize: '0.8rem',
                lineHeight: 1.4,
                fontFamily: 'inherit'
              }}
            >
              {log.message || log.raw}
            </pre>
          </div>
          
          {log.extra && Object.keys(log.extra).length > 0 && (
            <div 
              className="mt-2 text-muted font-monospace small"
              style={{ 
                marginLeft: 'calc(140px + 80px + 24px)',
                fontSize: '0.7rem',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word'
              }}
            >
              {JSON.stringify(log.extra, null, 2)}
            </div>
          )}
        </div>
      ))}
      <div ref={endOfLogsRef} />
      
      <style dangerouslySetInnerHTML={{
        __html: `
          .slide-in {
            animation: slideInFromTop 0.3s ease-out forwards;
          }
          
          @keyframes slideInFromTop {
            from {
              opacity: 0;
              transform: translateY(-10px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
          
          .log-entry:hover {
            transform: translateX(3px);
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          }
          
          .log-viewer::-webkit-scrollbar {
            width: 8px;
          }
          
          .log-viewer::-webkit-scrollbar-track {
            background: rgba(255,255,255,0.1);
          }
          
          .log-viewer::-webkit-scrollbar-thumb {
            background: rgba(255,255,255,0.3);
            border-radius: 4px;
          }
          
          .log-viewer::-webkit-scrollbar-thumb:hover {
            background: rgba(255,255,255,0.5);
          }
        `
      }} />
    </div>
  );
};

export default LogViewer;

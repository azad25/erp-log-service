import { useState, useEffect, useCallback, useRef } from 'react';
import { LogEntry } from '../types/logs';
import { useWebSocket } from '../contexts/WebSocketContext';
import { getLogs } from '../services/api';

export interface UseLogMessagesResult {
  logs: LogEntry[];
  cleanup: () => void;
  isConnected: boolean;
  isConnecting: boolean;
  handleLogMessage: (log: LogEntry) => void;
  error: Error | null;
  loadMoreLogs: () => Promise<void>;
  isLoadingMore: boolean;
  hasMoreLogs: boolean;
  disconnect: (containerId: string) => void;
}

export const useLogMessages = (containerId: string | null, maxLogs: number = 25): UseLogMessagesResult => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMoreLogs, setHasMoreLogs] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const seenLogsRef = useRef<Set<string>>(new Set());
  const isMountedRef = useRef(true);
  
  const { connect, disconnect, isConnected } = useWebSocket();

  const createLogKey = (log: LogEntry): string => {
    return `${log.container_id}-${log.timestamp}-${log.message}`;
  };

  const handleLogMessage = useCallback((log: LogEntry) => {
    if (!isMountedRef.current) return;
    
    // Only add logs for the current container
    if (containerId && log.container_id !== containerId) {
      return;
    }
    
    const logKey = createLogKey(log);
    if (seenLogsRef.current.has(logKey)) {
      return;
    }
    
    seenLogsRef.current.add(logKey);
    
    setLogs(prevLogs => {
      const newLogs = [...prevLogs, log];
      // Sort by timestamp (oldest first)
      newLogs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      // Keep only the most recent maxLogs
      return newLogs.slice(-maxLogs);
    });
  }, [containerId, maxLogs]);

  const fetchInitialLogs = useCallback(async () => {
    if (!containerId || containerId === 'all') return;
    
    try {
      setError(null);
      const response = await getLogs(containerId, 25); // Initial load
      
      if (response && Array.isArray(response)) {
        const validLogs = response.filter((log: any) => 
          log && log.container_id && log.timestamp && log.message
        );
        
        // Clear seen logs and add new ones
        seenLogsRef.current.clear();
        validLogs.forEach((log: LogEntry) => {
          seenLogsRef.current.add(createLogKey(log));
        });
        
        setLogs(validLogs);
        setHasMoreLogs(validLogs.length === 25);
      }
    } catch (err) {
      console.error('Error fetching initial logs:', err);
      setError(err instanceof Error ? err : new Error('Failed to fetch logs'));
    }
  }, [containerId]);

  const loadMoreLogs = useCallback(async () => {
    if (!containerId || containerId === 'all' || isLoadingMore || !hasMoreLogs) {
      return;
    }

    try {
      setIsLoadingMore(true);
      setError(null);
      
      // Get the oldest log timestamp for pagination
      const sortedLogs = [...logs].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
      const oldestLog = sortedLogs.length > 0 ? sortedLogs[0] : null;
      const beforeTimestamp = oldestLog ? oldestLog.timestamp : undefined;
      
      const response = await getLogs(containerId, 25, beforeTimestamp);
      
      if (response && Array.isArray(response)) {
        const validLogs = response.filter((log: any) => 
          log && log.container_id && log.timestamp && log.message
        );
        
        // Filter out logs we've already seen
        const newLogs = validLogs.filter((log: LogEntry) => {
          const logKey = createLogKey(log);
          return !seenLogsRef.current.has(logKey);
        });
        
        // Add new logs to seen set
        newLogs.forEach((log: LogEntry) => {
          seenLogsRef.current.add(createLogKey(log));
        });
        
        if (newLogs.length > 0) {
          setLogs(prevLogs => {
            // Prepend older logs to the beginning
            const allLogs = [...newLogs, ...prevLogs];
            // Sort by timestamp (oldest first)
            allLogs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
            // Keep reasonable number of logs in memory
            return allLogs.slice(-(maxLogs * 4)); // Allow more history for Load More
          });
        }
        
        // If we got fewer logs than requested, we've reached the end
        setHasMoreLogs(validLogs.length === 25 && newLogs.length > 0);
      } else {
        setHasMoreLogs(false);
      }
    } catch (err) {
      console.error('Error loading more logs:', err);
      setError(err instanceof Error ? err : new Error('Failed to load more logs'));
    } finally {
      setIsLoadingMore(false);
    }
  }, [containerId, isLoadingMore, hasMoreLogs, logs, maxLogs]);

  const cleanup = useCallback(() => {
    isMountedRef.current = false;
    setLogs([]);
    seenLogsRef.current.clear();
    setError(null);
    setHasMoreLogs(true);
    setIsLoadingMore(false);
    setIsConnecting(false);
  }, []);

  // Main effect for container changes
  useEffect(() => {
    if (!containerId || containerId === 'all') return;

    isMountedRef.current = true;
    setIsConnecting(true);

    // Clear previous data when container changes
    setLogs([]);
    seenLogsRef.current.clear();
    setHasMoreLogs(true);
    setIsLoadingMore(false);

    // Fetch initial logs first, then connect WebSocket
    fetchInitialLogs().then(() => {
      if (isMountedRef.current) {
        connect(containerId);
        setIsConnecting(false);
      }
    });

    return () => {
      // Only disconnect when container actually changes, not on every re-render
      if (containerId && containerId !== 'all') {
        // Remove setTimeout to prevent delayed disconnections
        disconnect(containerId);
      }
    };
  }, [containerId, connect, disconnect, fetchInitialLogs]);

  // Listen for real-time log messages
  useEffect(() => {
    const handleLogEvent = (event: CustomEvent) => {
      const { log, containerId: logContainerId } = event.detail;
      if (logContainerId === containerId && isMountedRef.current) {
        handleLogMessage(log);
      }
    };

    window.addEventListener('logMessage', handleLogEvent as EventListener);
    
    return () => {
      window.removeEventListener('logMessage', handleLogEvent as EventListener);
    };
  }, [containerId, handleLogMessage]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  return {
    logs,
    cleanup,
    isConnected: containerId ? isConnected(containerId) : false,
    isConnecting,
    handleLogMessage,
    error,
    loadMoreLogs,
    isLoadingMore,
    hasMoreLogs,
    disconnect,
  };
};

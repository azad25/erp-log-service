import { useState, useEffect, useCallback, useRef } from 'react';
import { LogEntry } from '../types/logs';
import { useWebSocket } from '../contexts/WebSocketContext';

export interface UseLogMessagesResult {
  logs: LogEntry[];
  cleanup: () => void;
  isConnected: boolean;
  isConnecting: boolean;
  handleLogMessage: (log: LogEntry) => void;
}

export const useLogMessages = (containerId: string): UseLogMessagesResult => {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isConnecting, setIsConnecting] = useState<boolean>(true);
  const { isConnected: wsIsConnected, connect, disconnect } = useWebSocket();
  const seenLogsRef = useRef<Set<string>>(new Set());
  const pendingLogsRef = useRef<LogEntry[]>([]);
  const updateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const currentContainerRef = useRef<string>(containerId);

  // Create a unique key for log entry to prevent duplicates
  const createLogKey = useCallback((log: LogEntry): string => {
    return `${log.timestamp}-${log.message}-${log.level}`;
  }, []);

  // Handle incoming log messages with throttling
  const handleLogMessage = useCallback((log: LogEntry) => {
    const logKey = createLogKey(log);
    if (!seenLogsRef.current.has(logKey)) {
      seenLogsRef.current.add(logKey);
      pendingLogsRef.current.push(log);

      // Update logs with throttling
      if (!updateTimeoutRef.current) {
        updateTimeoutRef.current = setTimeout(() => {
          setLogs(prevLogs => [...prevLogs, ...pendingLogsRef.current]);
          pendingLogsRef.current = [];
          updateTimeoutRef.current = null;
        }, 100); // Throttle updates to every 100ms
      }
    }
  }, [createLogKey]);

  // Connect to WebSocket when containerId changes
  useEffect(() => {
    if (!containerId) return;

    currentContainerRef.current = containerId;
    setIsConnecting(true);

    // Connect using the WebSocket context
    connect(containerId);

    // Listen for WebSocket message events
    const handleMessage = (event: CustomEvent<{ log: LogEntry; containerId: string }>) => {
      if (event.detail.containerId === containerId) {
        handleLogMessage(event.detail.log);
      }
    };

    // Update connection status
    const updateConnectionStatus = () => {
      const isWsConnected = wsIsConnected(containerId);
      setIsConnecting(!isWsConnected);
    };

    // Set up connection status listener
    window.addEventListener('websocket_status', updateConnectionStatus);

    window.addEventListener('logMessage', handleMessage as EventListener);
    
    // Update initial connection status
    updateConnectionStatus();

    // Cleanup function
    return () => {
      const timeoutToClean = reconnectTimeoutRef.current;
      const updateTimeout = updateTimeoutRef.current;
      
      window.removeEventListener('logMessage', handleMessage as EventListener);
      window.removeEventListener('websocket_status', updateConnectionStatus);
      
      disconnect(containerId);
      
      if (updateTimeout) {
        clearTimeout(updateTimeout);
      }
      if (timeoutToClean) {
        clearTimeout(timeoutToClean);
      }
      
      setIsConnecting(false);
      currentContainerRef.current = '';
    };
  }, [containerId, connect, disconnect, wsIsConnected, handleLogMessage]);

  // Cleanup function
  const cleanup = useCallback(() => {
    if (updateTimeoutRef.current) {
      clearTimeout(updateTimeoutRef.current);
      updateTimeoutRef.current = null;
    }
    pendingLogsRef.current = [];
    seenLogsRef.current.clear();
    setLogs([]);
  }, []);

  return {
    logs,
    cleanup,
    isConnected: wsIsConnected(currentContainerRef.current),
    isConnecting,
    handleLogMessage
  };
};

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { LogEntry } from '../types/logs';
import { useWebSocket } from '../contexts/WebSocketContext';

// Safe console that works in all environments
const safeConsole = {
  log: (...args: any[]) => {
    try {
      if (typeof console !== 'undefined' && console.log) {
        console.log(...args);
      }
    } catch (e) {
      // No-op
    }
  },
  warn: (...args: any[]) => {
    try {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn(...args);
      }
    } catch (e) {
      // No-op
    }
  },
  error: (...args: any[]) => {
    try {
      if (typeof console !== 'undefined' && console.error) {
        console.error(...args);
      }
    } catch (e) {
      // No-op
    }
  }
};

export interface UseLogMessagesResult {
  logs: LogEntry[];
  cleanup: () => void;
  isConnected: boolean;
  isConnecting: boolean;
  handleLogMessage: (log: LogEntry) => void;
  error: Error | null;
}

export const useLogMessages = (containerId: string, maxLogs: number = 1000): UseLogMessagesResult => {
  // Configuration
  const BATCH_SIZE = 50; // Number of logs to process in a single batch
  const BATCH_INTERVAL = 100; // ms between batch updates

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isConnecting, setIsConnecting] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const { isConnected: wsIsConnected, connect, disconnect } = useWebSocket();
  
  // Refs for state that shouldn't trigger re-renders
  const seenLogsRef = useRef<Set<string>>(new Set());
  const pendingLogsRef = useRef<LogEntry[]>([]);
  const updateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const currentContainerRef = useRef<string>(containerId);
  const reconnectAttempts = useRef<Record<string, number>>({});
  const isMountedRef = useRef<boolean>(true);

  // Create a unique key for log entry to prevent duplicates
  const createLogKey = useCallback((log: LogEntry): string => {
    return `${log.timestamp}-${log.message}-${log.level}`;
  }, []);

  // Process pending logs in batches to prevent UI freezes
  const processPendingLogs = useCallback(() => {
    if (!isMountedRef.current || pendingLogsRef.current.length === 0) {
      return;
    }

    // Process logs in smaller batches
    const batch = pendingLogsRef.current.splice(0, BATCH_SIZE);
    
    setLogs(prevLogs => {
      const newLogs = [...prevLogs, ...batch];
      
      // Trim logs to maxLogs if needed
      return newLogs.length > maxLogs 
        ? newLogs.slice(-maxLogs)
        : newLogs;
    });

    // Schedule next batch if there are more logs to process
    if (pendingLogsRef.current.length > 0) {
      updateTimeoutRef.current = setTimeout(processPendingLogs, BATCH_INTERVAL);
    } else {
      updateTimeoutRef.current = null;
    }
  }, []);

  // Handle incoming log messages with throttling and duplicate prevention
  const handleLogMessage = useCallback((log: LogEntry) => {
    try {
      // Validate log entry
      if (!log || typeof log !== 'object' || !log.timestamp || !log.message) {
        safeConsole.warn('Received invalid log entry:', log);
        return;
      }

      // Ensure message is a string
      const sanitizedLog = {
        ...log,
        message: String(log.message),
        timestamp: new Date(log.timestamp).toISOString(),
        level: log.level || 'info',
      };

      const logKey = createLogKey(sanitizedLog);
      
      // Prevent duplicate logs
      if (seenLogsRef.current.has(logKey)) {
        return;
      }
      
      seenLogsRef.current.add(logKey);
      pendingLogsRef.current.push(sanitizedLog);

      // Start processing logs if not already in progress
      if (!updateTimeoutRef.current) {
        updateTimeoutRef.current = setTimeout(processPendingLogs, BATCH_INTERVAL);
      }
    } catch (error) {
      safeConsole.error('Error processing log message:', error, log);
    }
  }, [createLogKey]);

  // Load initial logs via HTTP API
  const loadInitialLogs = useCallback(async (containerId: string) => {
    try {
      const response = await fetch(`/api/v1/logs/${containerId}?tail=50&timestamps=true`);
      if (response.ok) {
        const initialLogs = await response.json();
        if (Array.isArray(initialLogs) && initialLogs.length > 0) {
          safeConsole.log(`Loaded ${initialLogs.length} initial logs for ${containerId}`);
          initialLogs.forEach(log => handleLogMessage(log));
        }
      } else {
        safeConsole.error(`Failed to load initial logs: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      safeConsole.error('Error loading initial logs:', error);
    }
  }, [handleLogMessage]);

  // Enhanced WebSocket connection management
  // WebSocket connection and message handling
  useEffect(() => {
    if (!containerId) return undefined;
    
    // Mark component as mounted
    isMountedRef.current = true;
    currentContainerRef.current = containerId;
    setIsConnecting(true);

    // Load initial logs first
    loadInitialLogs(containerId);

    // Connect using the WebSocket context
    connect(containerId);

    // Listen for WebSocket message events
    const handleMessage = (event: CustomEvent<{ log: LogEntry; containerId: string }>) => {
      console.log('useLogMessages received event:', event.detail);
      if (event.detail.containerId === containerId && isMountedRef.current) {
        console.log('Processing log message for container:', containerId, event.detail.log);
        handleLogMessage(event.detail.log);
      }
    };

    // Update connection status
    const updateConnectionStatus = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.containerId === containerId && isMountedRef.current) {
        const isConnected = detail.connected === true;
        setIsConnecting(!isConnected);
        
        // Reset reconnect attempts on successful connection
        if (isConnected) {
          reconnectAttempts.current[containerId] = 0;
        }
      }
    };

    // Set up connection status listener
    const connectionListener = (e: Event) => updateConnectionStatus(e);
    window.addEventListener('websocket_status', connectionListener);
    window.addEventListener('logMessage', handleMessage as EventListener);
    
    // Initial connection status check
    const isConnected = wsIsConnected(containerId);
    setIsConnecting(!isConnected);

    // Set up periodic connection health check
    const healthCheckInterval = setInterval(() => {
      if (!wsIsConnected(containerId) && !reconnectTimeoutRef.current) {
        safeConsole.log(`Connection lost for ${containerId}, attempting to reconnect...`);
        connect(containerId);
      }
    }, 10000); // Check every 10 seconds

    // Cleanup function
    return () => {
      isMountedRef.current = false;
      
      // Clear any pending timeouts
      if (updateTimeoutRef.current) {
        clearTimeout(updateTimeoutRef.current);
        updateTimeoutRef.current = null;
      }
      
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      
      // Clear interval
      clearInterval(healthCheckInterval);
      
      // Clear event listeners
      window.removeEventListener('websocket_status', connectionListener);
      window.removeEventListener('logMessage', handleMessage as EventListener);
      
      // Disconnect WebSocket
      disconnect(containerId);
    };
  }, [containerId, connect, disconnect, wsIsConnected, handleLogMessage]);

  // Cleanup function to be called by parent component
  const cleanup = useCallback(() => {
    isMountedRef.current = false;
    
    // Clear any pending timeouts
    if (updateTimeoutRef.current) {
      clearTimeout(updateTimeoutRef.current);
      updateTimeoutRef.current = null;
    }
    
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    // Clear large data structures
    seenLogsRef.current.clear();
    pendingLogsRef.current = [];
    
    // Disconnect WebSocket
    if (containerId) {
      disconnect(containerId);
    }
    
    // Reset state
    setLogs([]);
    setIsConnecting(false);
  }, [containerId, disconnect]);

  return {
    logs,
    cleanup,
    isConnected: wsIsConnected(currentContainerRef.current),
    isConnecting,
    handleLogMessage,
    error
  };
};

import { useState, useEffect, useCallback, useRef } from 'react';
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
  loadMoreLogs: () => Promise<void>;
  isLoadingMore: boolean;
  hasMoreLogs: boolean;
}

export const useLogMessages = (containerId: string, maxLogs: number = 1000): UseLogMessagesResult => {
  // Configuration
  const BATCH_SIZE = 50; // Number of logs to process in a single batch
  const BATCH_INTERVAL = 100; // ms between batch updates

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isConnecting, setIsConnecting] = useState<boolean>(true);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [hasMoreLogs, setHasMoreLogs] = useState<boolean>(true);
  const [error] = useState<Error | null>(null);
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
  }, [maxLogs]);

  // Handle incoming log messages with throttling and duplicate prevention
  const handleLogMessage = useCallback((log: LogEntry) => {
    try {
      // Validate log entry
      if (!log || typeof log !== 'object' || !log.timestamp || !log.message) {
        safeConsole.warn('Received invalid log entry:', log);
        return;
      }

      // Ensure message is a string and all required fields are present
      const sanitizedLog = {
        ...log,
        message: String(log.message || log.raw || ''),
        timestamp: new Date(log.timestamp).toISOString(),
        level: log.level || 'info',
        container: log.container || log.containerId || containerId,
        containerId: log.containerId || log.container_id || containerId,
        raw: log.raw || log.message || ''
      };

      const logKey = createLogKey(sanitizedLog);
      
      // Prevent duplicate logs
      if (seenLogsRef.current.has(logKey)) {
        safeConsole.log('Skipping duplicate log:', logKey);
        return;
      }
      
      seenLogsRef.current.add(logKey);
      pendingLogsRef.current.push(sanitizedLog);

      safeConsole.log(`Added log to pending queue for ${containerId}:`, sanitizedLog.message);

      // Start processing logs if not already in progress
      if (!updateTimeoutRef.current) {
        updateTimeoutRef.current = setTimeout(processPendingLogs, BATCH_INTERVAL);
      }
    } catch (error) {
      safeConsole.error('Error processing log message:', error, log);
    }
  }, [createLogKey, processPendingLogs, containerId]);

  // Load initial logs via HTTP API - limit to 20 logs
  const loadInitialLogs = useCallback(async (containerId: string) => {
    try {
      const apiBaseUrl = process.env.REACT_APP_API_URL || 'http://localhost:3004/api/v1';
      const response = await fetch(`${apiBaseUrl}/logs/${containerId}?tail=20&timestamps=true`);
      if (response.ok) {
        const initialLogs = await response.json();
        if (Array.isArray(initialLogs) && initialLogs.length > 0) {
          safeConsole.log(`Loaded ${initialLogs.length} initial logs for ${containerId}`);
          
          // Clear existing logs first to avoid duplicates
          setLogs([]);
          seenLogsRef.current.clear();
          pendingLogsRef.current = [];
          
          // Process initial logs directly without going through handleLogMessage to avoid duplicates
          const processedLogs = initialLogs.map(log => ({
            ...log,
            message: String(log.message || log.raw || ''),
            timestamp: new Date(log.timestamp).toISOString(),
            level: log.level || 'info',
            container: log.container || log.containerId || containerId,
            containerId: log.containerId || log.container_id || containerId,
            raw: log.raw || log.message || ''
          }));
          
          // Add to seen logs to prevent duplicates
          processedLogs.forEach(log => {
            const logKey = createLogKey(log);
            seenLogsRef.current.add(logKey);
          });
          
          // Set logs directly
          setLogs(processedLogs.slice(-20)); // Ensure we only keep last 20
        }
      } else {
        safeConsole.error(`Failed to load initial logs: ${response.status} ${response.statusText}`);
      }
    } catch (error) {
      safeConsole.error('Error loading initial logs:', error);
    }
  }, [createLogKey]);

  // Load more historical logs
  const loadMoreLogs = useCallback(async () => {
    if (!containerId || isLoadingMore || !hasMoreLogs) return;
    
    try {
      setIsLoadingMore(true);
      const apiBaseUrl = process.env.REACT_APP_API_URL || 'http://localhost:3004/api/v1';
      
      // Calculate the number of logs to fetch (current count + 20 more)
      const currentCount = logs.length;
      const fetchCount = currentCount + 20;
      
      const response = await fetch(`${apiBaseUrl}/logs/${containerId}?tail=${fetchCount}&timestamps=true`);
      if (response.ok) {
        const moreLogs = await response.json();
        if (Array.isArray(moreLogs) && moreLogs.length > currentCount) {
          safeConsole.log(`Loaded ${moreLogs.length - currentCount} more logs for ${containerId}`);
          
          // Process the new logs
          const processedLogs = moreLogs.map(log => ({
            ...log,
            message: String(log.message || log.raw || ''),
            timestamp: new Date(log.timestamp).toISOString(),
            level: log.level || 'info',
            container: log.container || log.containerId || containerId,
            containerId: log.containerId || log.container_id || containerId,
            raw: log.raw || log.message || ''
          }));
          
          // Add new logs to seen logs to prevent duplicates
          processedLogs.forEach(log => {
            const logKey = createLogKey(log);
            seenLogsRef.current.add(logKey);
          });
          
          // Update logs with the new ones, respecting maxLogs limit
          setLogs(prevLogs => {
            const combinedLogs = [...prevLogs, ...processedLogs.slice(currentCount)];
            return combinedLogs.length > maxLogs 
              ? combinedLogs.slice(-maxLogs)
              : combinedLogs;
          });
          
          // Check if we have more logs available
          if (moreLogs.length < fetchCount) {
            setHasMoreLogs(false);
          }
        } else {
          setHasMoreLogs(false);
        }
      } else {
        safeConsole.error(`Failed to load more logs: ${response.status} ${response.statusText}`);
        setHasMoreLogs(false);
      }
    } catch (error) {
      safeConsole.error('Error loading more logs:', error);
      setHasMoreLogs(false);
    } finally {
      setIsLoadingMore(false);
    }
  }, [containerId, isLoadingMore, hasMoreLogs, logs.length, createLogKey]);

  // WebSocket connection and message handling - prevent duplicate connections
  useEffect(() => {
    if (!containerId) return undefined;
    
    // Prevent duplicate connections in React StrictMode
    if (currentContainerRef.current === containerId && wsIsConnected(containerId)) {
      return undefined;
    }
    
    // Reset logs and state when container changes
    if (currentContainerRef.current !== containerId) {
      setLogs([]);
      seenLogsRef.current.clear();
      pendingLogsRef.current = [];
      setHasMoreLogs(true);
      setIsLoadingMore(false);
    }
    
    // Mark component as mounted
    isMountedRef.current = true;
    currentContainerRef.current = containerId;
    setIsConnecting(true);

    // Debounce connection to prevent React StrictMode double execution
    const connectionTimer = setTimeout(() => {
      if (isMountedRef.current && !wsIsConnected(containerId)) {
        // Load initial logs first
        loadInitialLogs(containerId);
        // Connect using the WebSocket context
        connect(containerId);
      }
    }, 100); // Small delay to prevent duplicate connections

    // Listen for WebSocket message events
    const handleMessage = (event: CustomEvent<{ log: LogEntry; containerId: string }>) => {
      if (event.detail.containerId === containerId && isMountedRef.current) {
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
      
      // Clear connection timer
      clearTimeout(connectionTimer);
      
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
  }, [containerId, connect, disconnect, wsIsConnected, handleLogMessage, loadInitialLogs]);

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
    error,
    loadMoreLogs,
    isLoadingMore,
    hasMoreLogs
  };
};

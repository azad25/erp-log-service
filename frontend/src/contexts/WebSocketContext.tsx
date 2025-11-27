import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useCallback,
  ReactNode,
  useState,
  useMemo,
} from 'react';
import { LogEntry } from '../types/logs';

// Constants
const MAX_RECONNECT_ATTEMPTS = 5;
const BASE_RECONNECT_DELAY = 1000; // 1 second

interface WebSocketContextType {
  sendMessage: (message: any, containerId?: string) => void;
  isConnected: (containerId: string) => boolean;
  connect: (containerId: string) => void;
  disconnect: (containerId: string) => void;
  connectionStatus: Record<string, boolean>;
}

const WebSocketContext = createContext<WebSocketContextType | null>(null);

interface WebSocketProviderProps {
  children: ReactNode;
  onMessage: (data: LogEntry, containerId: string) => void;
}

export const WebSocketProvider: React.FC<WebSocketProviderProps> = ({
  children,
  onMessage,
}) => {
  // State
  const [connectionStatus, setConnectionStatus] = useState<Record<string, boolean>>({});
  
  // Refs for WebSocket connections and timeouts
  const connections = useRef<Record<string, WebSocket>>({});
  const reconnectAttempts = useRef<Record<string, number>>({});
  const pingIntervals = useRef<Record<string, NodeJS.Timeout>>({});
  const pongTimeouts = useRef<Record<string, NodeJS.Timeout>>({});
  const reconnectTimeouts = useRef<Record<string, NodeJS.Timeout>>({});
  const isClosing = useRef<Record<string, boolean>>({});
  const connectionRefs = useRef<Record<string, number>>({}); // Reference counting
  
  // Refs to store functions to avoid circular dependencies
  const connectRef = useRef<((containerId: string) => void) | null>(null);
  const scheduleReconnectRef = useRef<((containerId: string) => void) | null>(null);
  
  // Optimized console logging
  const safeConsole = useMemo(() => ({
    log: process.env.NODE_ENV === 'development' ? console.log : () => {},
    error: process.env.NODE_ENV === 'development' ? console.error : () => {},
    warn: process.env.NODE_ENV === 'development' ? console.warn : () => {}
  }), []);

  // Clean up connection resources
  const cleanupConnection = useCallback((containerId: string) => {
    // Clear all timeouts and intervals
    if (pingIntervals.current[containerId]) {
      clearInterval(pingIntervals.current[containerId]);
      delete pingIntervals.current[containerId];
    }
    
    if (pongTimeouts.current[containerId]) {
      clearTimeout(pongTimeouts.current[containerId]);
      delete pongTimeouts.current[containerId];
    }
    
    if (reconnectTimeouts.current[containerId]) {
      clearTimeout(reconnectTimeouts.current[containerId]);
      delete reconnectTimeouts.current[containerId];
    }
    
    // Close WebSocket if open
    const ws = connections.current[containerId];
    if (ws) {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close(1000, 'Connection cleanup');
      }
      delete connections.current[containerId];
    }
    
    // Clean up refs
    delete reconnectAttempts.current[containerId];
    delete isClosing.current[containerId];
    delete connectionRefs.current[containerId];
    
    // Update connection status
    setConnectionStatus(prev => {
      const newStatus = { ...prev };
      delete newStatus[containerId];
      return newStatus;
    });
  }, []);

  // Setup ping/pong mechanism - disabled, backend handles it
  const setupPing = useCallback((containerId: string, ws: WebSocket) => {
    // Ping/pong disabled - backend handles connection health
    // Clear any existing intervals just in case
    if (pingIntervals.current[containerId]) {
      clearInterval(pingIntervals.current[containerId]);
      delete pingIntervals.current[containerId];
    }
    if (pongTimeouts.current[containerId]) {
      clearTimeout(pongTimeouts.current[containerId]);
      delete pongTimeouts.current[containerId];
    }
  }, []);

  // Enhanced reconnection logic with exponential backoff and jitter
  const scheduleReconnect = useCallback((containerId: string) => {
    if (isClosing.current[containerId]) return;
    
    const attempts = reconnectAttempts.current[containerId] || 0;
    if (attempts >= MAX_RECONNECT_ATTEMPTS) {
      safeConsole.warn(`Max reconnection attempts reached for container ${containerId}`);
      cleanupConnection(containerId);
      return;
    }
    
    // Add jitter to prevent thundering herd problem
    const jitter = Math.random() * 1000;
    const delay = Math.min(
      BASE_RECONNECT_DELAY * Math.pow(2, attempts) + jitter,
      30000
    );
    
    safeConsole.log(`Scheduling reconnection for ${containerId} in ${Math.round(delay)}ms (attempt ${attempts + 1})`);
    
    reconnectAttempts.current[containerId] = attempts + 1;
    
    // Clear any existing timeout to prevent multiple reconnection attempts
    if (reconnectTimeouts.current[containerId]) {
      clearTimeout(reconnectTimeouts.current[containerId]);
      delete reconnectTimeouts.current[containerId];
    }
    
    reconnectTimeouts.current[containerId] = setTimeout(() => {
      if (!isClosing.current[containerId] && connectRef.current) {
        safeConsole.log(`Attempting to reconnect to ${containerId}...`);
        connectRef.current(containerId);
      }
    }, delay);
  }, [safeConsole, cleanupConnection]);

  // Connect to WebSocket with enhanced error handling and reconnection
  const connect = useCallback((containerId: string) => {
    // Increment reference count for concurrent connection support
    connectionRefs.current[containerId] = (connectionRefs.current[containerId] || 0) + 1;
    
    // Allow multiple components to share the same connection
    const existingWs = connections.current[containerId];
    if (existingWs && (existingWs.readyState === WebSocket.CONNECTING || existingWs.readyState === WebSocket.OPEN)) {
      return; // Reuse existing connection
    }

    if (isClosing.current[containerId]) {
      return; // Skip if closing
    }

    // Clear any existing reconnection timeout
    if (reconnectTimeouts.current[containerId]) {
      clearTimeout(reconnectTimeouts.current[containerId]);
      delete reconnectTimeouts.current[containerId];
    }

    // Clean up existing connection properly
    if (existingWs) {
      try {
        existingWs.onopen = null;
        existingWs.onmessage = null;
        existingWs.onclose = null;
        existingWs.onerror = null;
        if (existingWs.readyState !== WebSocket.CLOSED) {
          existingWs.close(1000, 'Reconnecting...');
        }
      } catch (e) {
        // Silent cleanup
      }
      delete connections.current[containerId];
    }

    // Connect using dynamic WebSocket URL based on current location
    // This ensures WebSocket works when accessing via network URL
    const getWebSocketUrl = () => {
      // If REACT_APP_WS_URL is set and we're in development, use it
      if (process.env.REACT_APP_WS_URL && process.env.NODE_ENV === 'development') {
        return process.env.REACT_APP_WS_URL;
      }
      
      // Otherwise, dynamically determine WebSocket URL from current location
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.hostname;
      const port = '8093'; // Backend WebSocket port
      
      return `${protocol}//${host}:${port}`;
    };
    
    const wsBaseUrl = getWebSocketUrl();
    const wsUrl = `${wsBaseUrl}/ws/logs/${containerId}`;
    
    try {
      const ws = new WebSocket(wsUrl);
      connections.current[containerId] = ws;
      
      // Set connecting status immediately
      setConnectionStatus(prev => ({ ...prev, [containerId]: false }));

      ws.onopen = () => {
        // Use functional update to prevent stale closures
        setConnectionStatus(prev => ({ ...prev, [containerId]: true }));
        reconnectAttempts.current[containerId] = 0;
        setupPing(containerId, ws);

        // Dispatch connection status event
        window.dispatchEvent(new CustomEvent('websocket_status', {
          detail: { containerId, connected: true }
        }));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          // Handle ping from server - respond with pong
          if (data.type === 'ping') {
            try {
              ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
              safeConsole.log(`Responded to server ping for container: ${containerId}`);
            } catch (e) {
              safeConsole.error(`Failed to send pong for container ${containerId}:`, e);
            }
            return;
          }
          
          // Handle pong from server or connection established
          if (data.type === 'pong' || data.type === 'connection_established') {
            safeConsole.log(`Received ${data.type} for container: ${containerId}`);
            return;
          }
          
          if (data.type === 'log') {
            // Ensure the payload is properly structured with all required fields
            const logEntry = {
              ...data.payload,
              timestamp: data.payload.timestamp || data.timestamp || new Date().toISOString(),
              level: data.payload.level || 'info',
              message: data.payload.message || data.payload.raw || '',
              container: data.payload.container_id || data.payload.containerId || containerId,
              containerId: data.payload.container_id || data.payload.containerId || containerId,
              raw: data.payload.raw || data.payload.message || ''
            };
            
            // Dispatch event for real-time log updates
            const logEvent = new CustomEvent('logMessage', {
              detail: {
                log: logEntry,
                containerId
              }
            });
            window.dispatchEvent(logEvent);
            
            // Also call the onMessage callback
            onMessage(logEntry, containerId);
          }
        } catch (error) {
          safeConsole.error(`Error processing WebSocket message for ${containerId}:`, error);
        }
      };

      ws.onclose = (event) => {
        // Clean up ping/pong timers
        if (pingIntervals.current[containerId]) {
          clearInterval(pingIntervals.current[containerId]);
          delete pingIntervals.current[containerId];
        }
        if (pongTimeouts.current[containerId]) {
          clearTimeout(pongTimeouts.current[containerId]);
          delete pongTimeouts.current[containerId];
        }
        
        // Remove from connections
        delete connections.current[containerId];
        
        // Use functional update to prevent stale closures
        setConnectionStatus(prev => ({ ...prev, [containerId]: false }));

        // Dispatch disconnection event
        window.dispatchEvent(new CustomEvent('websocket_status', {
          detail: { containerId, connected: false }
        }));
        
        // Only schedule reconnection for abnormal closures and if we still have active subscribers
        const hasActiveSubscribers = connectionRefs.current[containerId] > 0;
        if (!isClosing.current[containerId] && event.code !== 1000 && event.code !== 1001 && hasActiveSubscribers) {
          scheduleReconnectRef.current?.(containerId);
        } else if (isClosing.current[containerId] || !hasActiveSubscribers) {
          // Clean up completely if intentionally closing or no more subscribers
          delete isClosing.current[containerId];
          delete reconnectAttempts.current[containerId];
          delete connectionRefs.current[containerId];
        }
      };

      ws.onerror = (error) => {
        // Silent error handling - let onclose handle reconnection
      };

    } catch (error) {
      delete connections.current[containerId];
      setConnectionStatus(prev => ({ ...prev, [containerId]: false }));
      scheduleReconnectRef.current?.(containerId);
    }
  }, [setupPing, onMessage]);

  // Store refs for functions to avoid stale closures
  useEffect(() => {
    connectRef.current = connect;
    scheduleReconnectRef.current = scheduleReconnect;
  }, [connect, scheduleReconnect]);

  // Disconnect from WebSocket with reference counting
  const disconnect = useCallback((containerId: string) => {
    // Decrement reference count
    const currentCount = connectionRefs.current[containerId] || 0;
    const newCount = Math.max(0, currentCount - 1);
    connectionRefs.current[containerId] = newCount;

    // Only disconnect if no more references and add longer delay to prevent premature disconnection
    if (newCount === 0) {
      setTimeout(() => {
        // Double-check reference count after delay
        if (connectionRefs.current[containerId] === 0) {
          const ws = connections.current[containerId];
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.close(1000, 'Client disconnect');
          }
          delete connections.current[containerId];
          setConnectionStatus(prev => ({ ...prev, [containerId]: false }));
        }
      }, 3000); // Increased delay from 500ms to 3000ms
    }
  }, []);

  // Send message through WebSocket
  const sendMessage = useCallback((message: any, containerId?: string) => {
    if (containerId) {
      const ws = connections.current[containerId];
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify(message));
        } catch (error) {
          // Silent error handling
        }
      }
    } else {
      // Send to all open connections
      Object.entries(connections.current).forEach(([id, ws]) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify(message));
          } catch (error) {
            // Silent error handling
          }
        }
      });
    }
  }, []);

  // Check if connected
  const isConnected = useCallback((containerId: string) => {
    const ws = connections.current[containerId];
    return ws ? ws.readyState === WebSocket.OPEN : false;
  }, []);

  // Cleanup all connections on unmount
  useEffect(() => {
    return () => {
      // Mark all as closing
      Object.keys(connections.current).forEach(containerId => {
        isClosing.current[containerId] = true;
      });
      
      // Clear all timers
      Object.values(pingIntervals.current).forEach(clearInterval);
      Object.values(pongTimeouts.current).forEach(clearTimeout);
      Object.values(reconnectTimeouts.current).forEach(clearTimeout);
      
      // Close all connections
      Object.entries(connections.current).forEach(([containerId, ws]) => {
        if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
          ws.close(1000, 'Component unmounting');
        }
      });
      
      // Clear all refs
      connections.current = {};
      pingIntervals.current = {};
      pongTimeouts.current = {};
      reconnectTimeouts.current = {};
      reconnectAttempts.current = {};
      isClosing.current = {};
    };
  }, []);

  // Memoized context value to prevent unnecessary re-renders
  const contextValue = useMemo(() => ({
    sendMessage,
    isConnected,
    connect,
    disconnect,
    connectionStatus,
  }), [sendMessage, isConnected, connect, disconnect, connectionStatus]);

  return (
    <WebSocketContext.Provider value={contextValue}>
      {children}
    </WebSocketContext.Provider>
  );
};

export const useWebSocket = (): WebSocketContextType => {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
};

export default WebSocketContext;
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
const PING_INTERVAL = 30000; // 30 seconds
const PONG_TIMEOUT = 5000;   // 5 seconds
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
    
    // Update connection status
    setConnectionStatus(prev => {
      const newStatus = { ...prev };
      delete newStatus[containerId];
      return newStatus;
    });
  }, []);

  // Setup ping/pong mechanism
  const setupPing = useCallback((containerId: string, ws: WebSocket) => {
    // Clear existing ping interval
    if (pingIntervals.current[containerId]) {
      clearInterval(pingIntervals.current[containerId]);
    }
    
    pingIntervals.current[containerId] = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
        
        // Clear existing pong timeout
        if (pongTimeouts.current[containerId]) {
          clearTimeout(pongTimeouts.current[containerId]);
        }
        
        // Set pong timeout
        pongTimeouts.current[containerId] = setTimeout(() => {
          safeConsole.warn(`No pong received for container ${containerId}, closing connection`);
          ws.close(1000, 'Ping timeout');
        }, PONG_TIMEOUT);
      }
    }, PING_INTERVAL);
  }, [safeConsole]);

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
    // Prevent multiple connections or connecting to closing containers
    if (connections.current[containerId]?.readyState === WebSocket.OPEN || 
        isClosing.current[containerId]) {
      safeConsole.log(`WebSocket for ${containerId} already exists or is connecting`);
      return;
    }

    // Clear any existing reconnection timeout
    if (reconnectTimeouts.current[containerId]) {
      clearTimeout(reconnectTimeouts.current[containerId]);
      delete reconnectTimeouts.current[containerId];
    }

    // Close existing connection if it exists
    if (connections.current[containerId]) {
      try {
        connections.current[containerId].close(1000, 'Reconnecting...');
      } catch (e) {
        safeConsole.error('Error closing existing connection:', e);
      }
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // Use direct connection to backend for WebSocket connections
    const wsUrl = `${protocol}//${window.location.hostname}:8093/ws/logs/${containerId}`;
    safeConsole.log(`Connecting to WebSocket: ${wsUrl}`);
    
    try {
      const ws = new WebSocket(wsUrl);
      connections.current[containerId] = ws;
      
      // Set connecting status immediately
      setConnectionStatus(prev => ({ ...prev, [containerId]: false }));

      ws.onopen = () => {
        safeConsole.log(`WebSocket connected for container ${containerId}`);
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
          safeConsole.log(`Received WebSocket message for ${containerId}:`, data);
          
          if (data.type === 'pong' || data.type === 'connection_established') {
            // Clear pong timeout
            if (pongTimeouts.current[containerId]) {
              clearTimeout(pongTimeouts.current[containerId]);
              delete pongTimeouts.current[containerId];
            }
            return;
          }
          
          if (data.type === 'ping') {
            // Respond to ping with pong
            ws.send(JSON.stringify({ type: 'pong' }));
            return;
          }
          
          if (data.type === 'log') {
            // Ensure the payload is properly structured
            const logEntry = {
              ...data.payload,
              timestamp: data.payload.timestamp || new Date().toISOString(),
              level: data.payload.level || 'info',
              message: data.payload.message || data.payload.raw || '',
              container: data.payload.container_id || containerId, // Map container_id to container
              containerId: data.payload.container_id || containerId
            };

            // Debug: Log the parsed log entry
            console.log('WebSocket received log:', logEntry);
            
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
          safeConsole.error('Error parsing WebSocket message:', error);
        }
      };

      ws.onclose = (event) => {
        safeConsole.log(`WebSocket closed for container ${containerId}: ${event.code} ${event.reason}`);
        
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
        
        // Only schedule reconnection for abnormal closures and if not intentionally closing
        if (!isClosing.current[containerId] && event.code !== 1000 && event.code !== 1001) {
          scheduleReconnectRef.current?.(containerId);
        } else if (isClosing.current[containerId]) {
          // Clean up completely if intentionally closing
          delete isClosing.current[containerId];
          delete reconnectAttempts.current[containerId];
        }
      };

      ws.onerror = (error) => {
        safeConsole.error(`WebSocket error for container ${containerId}:`, error);
        // Don't schedule reconnect on error - let onclose handle it
      };

    } catch (error) {
      safeConsole.error(`Failed to create WebSocket for container ${containerId}:`, error);
      delete connections.current[containerId];
      setConnectionStatus(prev => ({ ...prev, [containerId]: false }));
      scheduleReconnectRef.current?.(containerId);
    }
  }, [onMessage, safeConsole, setupPing]);

  // Store functions in refs to avoid circular dependencies
  useEffect(() => {
    connectRef.current = connect;
    scheduleReconnectRef.current = scheduleReconnect;
  }, [connect, scheduleReconnect]);

  // Disconnect from WebSocket
  const disconnect = useCallback((containerId: string) => {
    isClosing.current[containerId] = true;
    cleanupConnection(containerId);
  }, [cleanupConnection]);

  // Send message through WebSocket
  const sendMessage = useCallback((message: any, containerId?: string) => {
    if (containerId) {
      const ws = connections.current[containerId];
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify(message));
        } catch (error) {
          safeConsole.error(`Error sending message to ${containerId}:`, error);
        }
      }
    } else {
      // Send to all open connections
      Object.entries(connections.current).forEach(([id, ws]) => {
        if (ws && ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify(message));
          } catch (error) {
            safeConsole.error(`Error sending broadcast message to ${id}:`, error);
          }
        }
      });
    }
  }, [safeConsole]);

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
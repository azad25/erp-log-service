import React, { createContext, useContext, useEffect, useRef, useCallback, ReactNode, useState } from 'react';
import { LogEntry } from '../types/logs';

interface WebSocketContextType {
  sendMessage: (message: any) => void;
  isConnected: boolean;
}

const WebSocketContext = createContext<WebSocketContextType | null>(null);

interface WebSocketProviderProps {
  children: ReactNode;
  onMessage: (data: LogEntry) => void;
}

export const WebSocketProvider: React.FC<WebSocketProviderProps> = ({ children, onMessage }) => {
  const ws = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 5;
  const reconnectTimeout = useRef<NodeJS.Timeout | null>(null);
  const pingInterval = useRef<NodeJS.Timeout | null>(null);
  const pongTimeout = useRef<NodeJS.Timeout | null>(null);
  const isClosing = useRef(false);

  const PING_INTERVAL = 30000; // 30 seconds
  const PONG_TIMEOUT = 5000;   // 5 seconds
  const RECONNECT_DELAY = 1000; // Base delay for reconnection

  const connect = useCallback(() => {
    // Clear any existing connection
    if (ws.current) {
      ws.current.onopen = null;
      ws.current.onclose = null;
      ws.current.onerror = null;
      ws.current.onmessage = null;
      
      try {
        if (ws.current.readyState === WebSocket.OPEN) {
          ws.current.close(1000, 'Reconnecting...');
        } else {
          ws.current.close();
        }
      } catch (error) {
        console.error('Error closing WebSocket:', error);
      }
      ws.current = null;
    }

    // In development, connect directly to the backend server
    // In production, use the same host as the frontend but with ws(s) protocol
    const isDev = process.env.NODE_ENV === 'development';
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    
    // Get container ID from URL or use 'all' to get logs from all containers
    const pathParts = window.location.pathname.split('/');
    const containerId = pathParts[pathParts.length - 1] || 'all';
    
    // Construct WebSocket URL
    let wsUrl: string;
    
    if (process.env.REACT_APP_WS_URL) {
      wsUrl = `${process.env.REACT_APP_WS_URL}/ws/logs/${containerId}`;
    } else if (isDev) {
      // In development, connect directly to the backend server
      const host = window.location.hostname;
      const port = '8093';
      wsUrl = `${wsProtocol}//${host}:${port}/ws/logs/${containerId}`;
    } else {
      // In production, use the same host as the frontend
      const host = window.location.host;
      wsUrl = `${wsProtocol}//${host}/ws/logs/${containerId}`;
    }
    
    // Clean up any potential double slashes
    const cleanWsUrl = wsUrl.replace(/([^:]\/)\/+/g, '$1');
    
    console.log('Connecting to WebSocket:', cleanWsUrl);
    ws.current = new WebSocket(cleanWsUrl);
    
    // Configure WebSocket with binary type for better performance
    ws.current.binaryType = 'arraybuffer';
    
    const setupPing = () => {
      if (pingInterval.current) clearInterval(pingInterval.current);
      
      pingInterval.current = setInterval(() => {
        if (ws.current?.readyState === WebSocket.OPEN) {
          try {
            ws.current.send('ping');
            
            // Set a timeout for pong
            if (pongTimeout.current) clearTimeout(pongTimeout.current);
            pongTimeout.current = setTimeout(() => {
              console.warn('Pong timeout, reconnecting...');
              if (ws.current) {
                ws.current.close(4000, 'Pong timeout');
              }
            }, PONG_TIMEOUT);
            
          } catch (error) {
            console.error('Error sending ping:', error);
          }
        }
      }, PING_INTERVAL);
    };

    ws.current.onopen = (event) => {
      console.log('WebSocket connected successfully');
      console.debug('WebSocket connection details:', {
        url: ws.current?.url,
        protocol: ws.current?.protocol,
        readyState: ws.current?.readyState
      });
      
      setIsConnected(true);
      reconnectAttempts.current = 0;
      isClosing.current = false;
      
      // Start ping/pong after short delay
      setTimeout(() => setupPing(), 1000);
      
      // Request initial log batch if needed
      if (ws.current?.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify({
          type: 'init',
          timestamp: Date.now()
        }));
      }
    };

    ws.current.onerror = (error) => {
      console.error('WebSocket error:', error);
      console.error('WebSocket readyState:', ws.current?.readyState);
      setIsConnected(false);
    };

    ws.current.onclose = (event) => {
      console.log(`WebSocket closed: ${event.code} ${event.reason || 'No reason provided'}`);
      console.debug('Close event details:', {
        wasClean: event.wasClean,
        code: event.code,
        reason: event.reason
      });
      
      setIsConnected(false);
      
      // Clear intervals and timeouts
      if (pingInterval.current) clearInterval(pingInterval.current);
      if (pongTimeout.current) clearTimeout(pongTimeout.current);
      
      // Don't reconnect on normal closure or if closing intentionally
      if (event.code === 1000 || isClosing.current) {
        console.log('WebSocket connection closed normally');
        return;
      }
      
      // Don't attempt to reconnect if we've exceeded max attempts
      if (reconnectAttempts.current >= maxReconnectAttempts) {
        console.error('Max reconnection attempts reached');
        return;
      }
      
      // Calculate backoff delay with jitter
      const baseDelay = Math.min(
        RECONNECT_DELAY * Math.pow(2, reconnectAttempts.current),
        30000 // Max 30 seconds
      );
      const jitter = Math.random() * 1000; // Add up to 1s jitter
      const delay = Math.floor(baseDelay + jitter);
      
      reconnectAttempts.current++;
      
      console.log(`Attempting to reconnect in ${delay}ms (attempt ${reconnectAttempts.current}/${maxReconnectAttempts})`);
      
      // Attempt to reconnect with backoff
      reconnectTimeout.current = setTimeout(() => {
        if (!isClosing.current) {
          connect();
        }
      }, delay);
    };

    ws.current.onmessage = (event) => {
      try {
        // Handle binary messages (if any)
        if (typeof event.data !== 'string') {
          console.warn('Received binary WebSocket message, expected text');
          return;
        }
        
        // Handle control messages
        if (event.data === 'pong') {
          if (pongTimeout.current) {
            clearTimeout(pongTimeout.current);
            pongTimeout.current = null;
          }
          return;
        }
        
        if (event.data === 'ping') {
          if (ws.current?.readyState === WebSocket.OPEN) {
            ws.current.send('pong');
          }
          return;
        }
        
        // Handle data messages
        try {
          const data = JSON.parse(event.data);
          
          // Process batched messages if needed
          if (Array.isArray(data)) {
            data.forEach((item) => onMessage(item));
          } else {
            onMessage(data);
          }
          
          // Reset reconnect attempts on successful message
          if (reconnectAttempts.current > 0) {
            reconnectAttempts.current = 0;
          }
        } catch (parseError) {
          console.error('Error parsing WebSocket message:', parseError, event.data);
        }
      } catch (error) {
        console.error('Error in WebSocket message handler:', error);
      }
    };
  }, [onMessage]);

  // Initialize WebSocket connection on mount and clean up on unmount
  useEffect(() => {
    connect();

    return () => {
      isClosing.current = true;
      
      // Clear all timeouts and intervals
      if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
      if (pingInterval.current) clearInterval(pingInterval.current);
      if (pongTimeout.current) clearTimeout(pongTimeout.current);
      
      // Close WebSocket connection
      if (ws.current) {
        ws.current.close(1000, 'Component unmounting');
      }
    };
  }, [connect]);

  const sendMessage = useCallback((message: any) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      try {
        const messageStr = typeof message === 'string' ? message : JSON.stringify(message);
        ws.current.send(messageStr);
      } catch (error) {
        console.error('Error sending WebSocket message:', error);
      }
    } else {
      console.warn('Cannot send message - WebSocket is not connected');
    }
  }, []);

  return (
    <WebSocketContext.Provider value={{ sendMessage, isConnected }}>
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

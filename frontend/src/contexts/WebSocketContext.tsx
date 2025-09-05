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

  const connect = useCallback(() => {
    if (ws.current) {
      ws.current.close();
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
      // If WS URL is explicitly set in environment, use it
      wsUrl = `${process.env.REACT_APP_WS_URL}/ws/logs/${containerId}`;
    } else if (isDev) {
      // In development, connect directly to the backend server
      const host = window.location.hostname;
      const port = '8093'; // Default backend port
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
    
    // Set up periodic heartbeat
    const heartbeatInterval = setInterval(() => {
      if (ws.current && ws.current.readyState === WebSocket.OPEN) {
        try {
          ws.current.send(JSON.stringify({ type: 'heartbeat', timestamp: Date.now() }));
        } catch (error) {
          console.error('Error sending heartbeat:', error);
        }
      }
    }, 30000); // Send heartbeat every 30 seconds

    ws.current.onopen = (event) => {
      console.log('WebSocket connected successfully');
      console.debug('WebSocket connection details:', {
        url: ws.current?.url,
        protocol: ws.current?.protocol,
        extensions: ws.current?.extensions,
        binaryType: ws.current?.binaryType
      });
      setIsConnected(true);
      reconnectAttempts.current = 0;
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
      clearInterval(heartbeatInterval);
      
      // Attempt to reconnect with exponential backoff
      if (reconnectAttempts.current < maxReconnectAttempts) {
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
        console.log(`Attempting to reconnect in ${delay}ms (attempt ${reconnectAttempts.current + 1}/${maxReconnectAttempts})`);
        
        reconnectTimeout.current = setTimeout(() => {
          reconnectAttempts.current++;
          connect();
        }, delay);
      } else {
        console.error('Max reconnection attempts reached');
      }
    };

    ws.current.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        onMessage(data);
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };

    ws.current.onclose = () => {
      console.log('WebSocket disconnected');
      setIsConnected(false);
      
      // Attempt to reconnect with exponential backoff
      if (reconnectAttempts.current < maxReconnectAttempts) {
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
        reconnectAttempts.current++;
        
        reconnectTimeout.current = setTimeout(() => {
          console.log(`Attempting to reconnect (${reconnectAttempts.current}/${maxReconnectAttempts})`);
          connect();
        }, delay);
      }
    };

    ws.current.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }, [onMessage]);

  // Connect on mount and clean up on unmount
  useEffect(() => {
    connect();

    return () => {
      if (ws.current) {
        ws.current.close();
      }
      if (reconnectTimeout.current) {
        clearTimeout(reconnectTimeout.current);
      }
    };
  }, [connect]);

  const sendMessage = useCallback((message: any) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(message));
    } else {
      console.warn('WebSocket is not connected');
    }
  }, []);

  const value = {
    sendMessage,
    isConnected,
  };

  return (
    <WebSocketContext.Provider value={value}>
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

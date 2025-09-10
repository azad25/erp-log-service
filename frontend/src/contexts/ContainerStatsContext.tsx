import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo, ReactNode } from 'react';

export interface ContainerStats {
  id: string;
  containerId: string;
  cpuUsage: number;
  cpuCount: number;
  memoryUsage: number;
  memoryLimit: number;
  networkRx: number;
  networkTx: number;
  blockRead: number;
  blockWrite: number;
  pids: number;
  timestamp: string;
}

// ContainerStatsState interface removed as it's not used

interface ContainerStatsContextType {
  stats: Record<string, ContainerStats>;
  isLoading: boolean;
  error: string | null;
  isConnected: (containerId: string) => boolean;
  connect: (containerId: string) => void;
  disconnect: (containerId: string) => void;
  startWatching: (containerId: string) => void;
  stopWatching: (containerId: string) => void;
}

const ContainerStatsContext = createContext<ContainerStatsContextType | null>(null);

interface ContainerStatsProviderProps {
  children: ReactNode;
}

// Constants
const RECONNECT_DELAY = 5000;
const MAX_RECONNECT_ATTEMPTS = 3;

export const ContainerStatsProvider: React.FC<ContainerStatsProviderProps> = ({ children }) => {
  // State for connection status and stats
  const [isLoading] = useState<boolean>(false);
  const [error] = useState<string | null>(null);
  const [stats, setStats] = useState<Record<string, ContainerStats>>({});
  const [connectionStatus, setConnectionStatus] = useState<Record<string, boolean>>({});
  
  // Refs to track connections and prevent memory leaks
  const connectionsRef = useRef<Record<string, WebSocket>>({});
  const reconnectTimeoutsRef = useRef<Record<string, NodeJS.Timeout>>({});
  const reconnectAttemptsRef = useRef<Record<string, number>>({});
  const isClosingRef = useRef<Record<string, boolean>>({});
  const connectionRefsRef = useRef<Record<string, number>>({}); // Reference counting
  const mountedRef = useRef(true);

  // Safe console for development - memoized to prevent unnecessary re-renders
  const safeConsole = useMemo(() => ({
    log: process.env.NODE_ENV === 'development' ? console.log : () => {},
    error: process.env.NODE_ENV === 'development' ? console.error : () => {},
    warn: process.env.NODE_ENV === 'development' ? console.warn : () => {}
  }), []);

  // Cleanup connection function
  const cleanupConnection = useCallback((containerId: string) => {
    // Clear reconnect timeout
    if (reconnectTimeoutsRef.current[containerId]) {
      clearTimeout(reconnectTimeoutsRef.current[containerId]);
      delete reconnectTimeoutsRef.current[containerId];
    }
    
    // Close WebSocket
    const ws = connectionsRef.current[containerId];
    if (ws) {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close(1000, 'Cleanup');
      }
      delete connectionsRef.current[containerId];
    }
    
    // Clean up refs
    delete reconnectAttemptsRef.current[containerId];
    delete isClosingRef.current[containerId];
    delete connectionRefsRef.current[containerId];
    
    // Update connection status only if component is still mounted
    if (mountedRef.current) {
      setConnectionStatus(prev => {
        const newStatus = { ...prev };
        delete newStatus[containerId];
        return newStatus;
      });
      
      // Remove stats for disconnected container
      setStats(prev => {
        const newStats = { ...prev };
        delete newStats[containerId];
        return newStats;
      });
    }
  }, []);

  // Connect function with proper error handling and reference counting
  const connect = useCallback((containerId: string) => {
    // Increment reference count
    connectionRefsRef.current[containerId] = (connectionRefsRef.current[containerId] || 0) + 1;
    
    // If already connected, just return
    if (connectionsRef.current[containerId] && connectionsRef.current[containerId].readyState === WebSocket.OPEN) {
      safeConsole.log(`Stats WebSocket already connected for ${containerId}, ref count: ${connectionRefsRef.current[containerId]}`);
      return;
    }
    
    // Prevent duplicate connections
    if (connectionsRef.current[containerId] || isClosingRef.current[containerId] || !mountedRef.current) {
      return;
    }

    try {
      // Connect using environment variable for WebSocket URL
      const wsBaseUrl = process.env.REACT_APP_WS_URL || 'ws://localhost:8093';
      let wsUrl = `${wsBaseUrl}/ws/stats/${containerId}`;
      
      const newWs = new WebSocket(wsUrl);
      connectionsRef.current[containerId] = newWs;

      // Set connecting status
      if (mountedRef.current) {
        setConnectionStatus(prev => ({ ...prev, [containerId]: false }));
      }

      newWs.onopen = () => {
        safeConsole.log(`Stats WebSocket connected for container ${containerId}`);
        reconnectAttemptsRef.current[containerId] = 0;
        
        if (mountedRef.current) {
          setConnectionStatus(prev => ({ ...prev, [containerId]: true }));
        }
      };

      newWs.onmessage = (event) => {
        if (!mountedRef.current) return;
        
        try {
          const data = JSON.parse(event.data);
          
          // Handle connection establishment
          if (data.type === 'connection_established') {
            safeConsole.log(`Stats connection established for ${containerId}`);
            return;
          }
          
          if (data.type === 'ping') {
            // Respond to ping with pong
            newWs.send(JSON.stringify({ type: 'pong' }));
            return;
          }
          
          if (data.type === 'pong') {
            // Clear any pong timeout if needed
            return;
          }
          if (data.type === 'stats' && data.payload) {
            if (mountedRef.current) {
              const statsData: ContainerStats = {
                id: data.payload.containerId || data.payload.container_id || containerId,
                containerId: data.payload.containerId || data.payload.container_id || containerId,
                cpuUsage: Number(data.payload.cpuUsage) || 0,
                cpuCount: Number(data.payload.cpuCount) || 1,
                memoryUsage: Number(data.payload.memoryUsage) || 0,
                memoryLimit: Number(data.payload.memoryLimit) || 1024,
                networkRx: Number(data.payload.networkRx) || 0,
                networkTx: Number(data.payload.networkTx) || 0,
                blockRead: Number(data.payload.blockRead) || 0,
                blockWrite: Number(data.payload.blockWrite) || 0,
                pids: Number(data.payload.pids) || 0,
                timestamp: data.timestamp || new Date().toISOString()
              };
              
              safeConsole.log('WebSocket received stats:', data);
              safeConsole.log('Updating stats for container:', containerId, statsData);
              
              setStats(prev => ({
                ...prev,
                [containerId]: statsData
              }));
            }
          } else if (data.type === 'connection_established') {
            safeConsole.log('Stats WebSocket connection established for:', containerId);
          } else if (data.type === 'error') {
            safeConsole.error(`Stats WebSocket error for ${containerId}:`, data.message);
          }
        } catch (error) {
          safeConsole.error('Error parsing WebSocket message:', error);
        }
      };

      newWs.onclose = (event) => {
        safeConsole.log(`Stats WebSocket closed for container ${containerId}: ${event.code}`);
        
        // Remove from connections
        delete connectionsRef.current[containerId];
        
        if (mountedRef.current) {
          setConnectionStatus(prev => ({ ...prev, [containerId]: false }));
        }
        
        // Schedule reconnection if not intentionally closing and component is mounted
        if (!isClosingRef.current[containerId] && mountedRef.current && event.code !== 1000) {
          const attempts = reconnectAttemptsRef.current[containerId] || 0;
          
          if (attempts < MAX_RECONNECT_ATTEMPTS) {
            safeConsole.log(`Scheduling stats reconnection for ${containerId} (attempt ${attempts + 1})`);
            reconnectAttemptsRef.current[containerId] = attempts + 1;
            
            reconnectTimeoutsRef.current[containerId] = setTimeout(() => {
              if (mountedRef.current && !isClosingRef.current[containerId]) {
                connect(containerId);
              }
            }, RECONNECT_DELAY);
          } else {
            safeConsole.warn(`Max reconnect attempts reached for stats container ${containerId}`);
            cleanupConnection(containerId);
          }
        }
      };

      newWs.onerror = (error) => {
        safeConsole.error('WebSocket error:', error);
        // Let onclose handle reconnection
      };

    } catch (error) {
      safeConsole.error(`Failed to create stats WebSocket for container ${containerId}:`, error);
      if (mountedRef.current) {
        setConnectionStatus(prev => ({ ...prev, [containerId]: false }));
      }
    }
  }, [safeConsole, cleanupConnection]);

  // Disconnect function with reference counting
  const disconnect = useCallback((containerId: string) => {
    // Decrement reference count
    const currentRefs = connectionRefsRef.current[containerId] || 0;
    if (currentRefs > 1) {
      connectionRefsRef.current[containerId] = currentRefs - 1;
      safeConsole.log(`Stats WebSocket ref count decreased for ${containerId}, remaining: ${connectionRefsRef.current[containerId]}`);
      return; // Don't disconnect yet, other components still using it
    }
    
    // Only disconnect if this is the last reference
    safeConsole.log(`Stats WebSocket disconnecting ${containerId}, last reference`);
    isClosingRef.current[containerId] = true;
    cleanupConnection(containerId);
  }, [cleanupConnection]);

  // Check connection status
  const isConnected = useCallback((containerId: string) => {
    return connectionStatus[containerId] === true;
  }, [connectionStatus]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      mountedRef.current = false;
      
      // Mark all as closing
      Object.keys(connectionsRef.current).forEach(containerId => {
        isClosingRef.current[containerId] = true;
      });
      
      // Clear all timeouts
      Object.values(reconnectTimeoutsRef.current).forEach(timeout => {
        clearTimeout(timeout);
      });
      
      // Close all connections
      Object.values(connectionsRef.current).forEach(ws => {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close(1000, 'Component unmounting');
        }
      });
      
      // Clear all refs
      connectionsRef.current = {};
      reconnectTimeoutsRef.current = {};
      reconnectAttemptsRef.current = {};
      isClosingRef.current = {};
    };
  }, []);

  const startWatching = useCallback((containerId: string) => {
    connect(containerId);
  }, [connect]);

  const stopWatching = useCallback((containerId: string) => {
    disconnect(containerId);
  }, [disconnect]);

  const contextValue = {
    stats,
    isLoading,
    error,
    isConnected,
    connect,
    disconnect,
    startWatching,
    stopWatching
  };

  return (
    <ContainerStatsContext.Provider value={contextValue}>
      {children}
    </ContainerStatsContext.Provider>
  );
};

export const useContainerStats = (): ContainerStatsContextType => {
  const context = useContext(ContainerStatsContext);
  if (!context) {
    throw new Error('useContainerStats must be used within a ContainerStatsProvider');
  }
  return context;
};

export default ContainerStatsContext;
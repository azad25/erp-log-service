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

  // Connect function with proper error handling
  const connect = useCallback((containerId: string) => {
    // Prevent duplicate connections
    if (connectionsRef.current[containerId] || isClosingRef.current[containerId] || !mountedRef.current) {
      return;
    }

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/api/v1/stats/containers/${containerId}/ws`;
      
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
          if (data.type === 'stats' && data.payload) {
            // Use functional update to prevent stale closures
            setStats(prev => ({
              ...prev,
              [containerId]: {
                ...data.payload,
                id: containerId,
                timestamp: new Date().toISOString()
              }
            }));
          }
        } catch (error) {
          safeConsole.error('Error parsing stats message:', error);
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

  // Disconnect function
  const disconnect = useCallback((containerId: string) => {
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
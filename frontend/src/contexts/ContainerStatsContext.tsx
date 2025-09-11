import React, { createContext, useContext, useState, useEffect, useRef, useCallback, useMemo, ReactNode } from 'react';

export interface ContainerStats {
  id: string;
  containerId: string;
  cpuUsage: number;
  cpuCount: number;
  memoryUsage: number;
  memoryLimit: number;
  memoryPercent: number;
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
// Unused constants - kept for future use
// const RECONNECT_DELAY = 3000; // 3 seconds
// const MAX_RECONNECT_ATTEMPTS = 5;

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

  const connect = useCallback((containerId: string) => {
    connectionRefsRef.current[containerId] = (connectionRefsRef.current[containerId] || 0) + 1;
    
    const existingWs = connectionsRef.current[containerId];
    if (existingWs && (existingWs.readyState === WebSocket.CONNECTING || existingWs.readyState === WebSocket.OPEN)) {
      return; 
    }
    
    if (isClosingRef.current[containerId] || !mountedRef.current) {
      return;
    }
    
    if (connectionsRef.current[containerId]) {
      const existingWs = connectionsRef.current[containerId];
      if (existingWs.readyState !== WebSocket.CLOSED) {
        existingWs.close(1000, 'Reconnecting');
      }
      delete connectionsRef.current[containerId];
    }

    try {
      const wsBaseUrl = process.env.REACT_APP_WS_URL || 'ws://localhost:8093';
      const wsUrl = `${wsBaseUrl}/ws/stats/${containerId}`;
      
      try {
        const ws = new WebSocket(wsUrl);
        connectionsRef.current[containerId] = ws;
        
        ws.onopen = () => {
          safeConsole.log(`Stats WebSocket connected for container ${containerId}`);
          reconnectAttemptsRef.current[containerId] = 0;
          
          if (mountedRef.current) {
            setConnectionStatus(prev => ({ ...prev, [containerId]: true }));
          }
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            console.log('ContainerStatsContext: Received WebSocket message for', containerId, data);
            
            if (data.type === 'stats' && data.payload) {
              const statsData: ContainerStats = {
                id: data.payload.containerId || containerId,
                containerId: data.payload.containerId || containerId,
                cpuUsage: parseFloat(data.payload.cpuUsage) || 0,
                cpuCount: parseInt(data.payload.cpuCount) || 1,
                memoryUsage: parseFloat(data.payload.memoryUsage) || 0,
                memoryLimit: parseFloat(data.payload.memoryLimit) || 0,
                memoryPercent: parseFloat(data.payload.memoryPercent) || 0,
                networkRx: parseFloat(data.payload.networkRx) || 0,
                networkTx: parseFloat(data.payload.networkTx) || 0,
                blockRead: parseFloat(data.payload.blockRead) || 0,
                blockWrite: parseFloat(data.payload.blockWrite) || 0,
                pids: parseInt(data.payload.pids) || 0,
                timestamp: data.payload.timestamp || new Date().toISOString()
              };
              
              console.log('ContainerStatsContext: Parsed stats data:', statsData);
              
              setStats(prevStats => {
                const newStats = {
                  ...prevStats,
                  [containerId]: statsData
                };
                console.log('ContainerStatsContext: Updated stats state:', newStats);
                return newStats;
              });
            } else {
              console.log('ContainerStatsContext: Non-stats message:', data.type);
            }
          } catch (error) {
            safeConsole.error('Error parsing WebSocket message:', error);
          }
        };

        ws.onclose = (event) => {
          delete connectionsRef.current[containerId];
          
          if (!isClosingRef.current[containerId] && event.code !== 1000 && event.code !== 1001) {
            setTimeout(() => {
              if (!isClosingRef.current[containerId]) {
                connect(containerId);
              }
            }, 2000);
          }
        };

        ws.onerror = (error) => {
          safeConsole.error('WebSocket error:', error);
        };

      } catch (error) {
        safeConsole.error(`Failed to create stats WebSocket for container ${containerId}:`, error);
        if (mountedRef.current) {
          setConnectionStatus(prev => ({ ...prev, [containerId]: false }));
        }
      }
    } catch (error) {
      safeConsole.error(`Failed to create stats WebSocket for container ${containerId}:`, error);
      if (mountedRef.current) {
        setConnectionStatus(prev => ({ ...prev, [containerId]: false }));
      }
    }
  }, [safeConsole]);

  // Disconnect function with reference counting
  const disconnect = useCallback((containerId: string) => {
    // Decrement reference count
    const currentRefs = connectionRefsRef.current[containerId] || 0;
    if (currentRefs > 1) {
      connectionRefsRef.current[containerId] = currentRefs - 1;
      return; // Don't disconnect yet, other components still using it
    }
    
    // Only disconnect if this is the last reference
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
    // Decrement reference count
    const currentCount = connectionRefsRef.current[containerId] || 0;
    const newCount = Math.max(0, currentCount - 1);
    connectionRefsRef.current[containerId] = newCount;

    // Only disconnect if no more references and add delay to prevent premature disconnection
    if (newCount === 0) {
      setTimeout(() => {
        // Double-check reference count after delay
        if (connectionRefsRef.current[containerId] === 0) {
          disconnect(containerId);
        }
      }, 500);
    }
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
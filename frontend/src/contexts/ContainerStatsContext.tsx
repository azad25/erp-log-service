import React, { createContext, useContext, useState, useEffect, useRef, useCallback, ReactNode } from 'react';

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

interface ContainerStatsContextType {
  stats: Record<string, ContainerStats>;
  isLoading: boolean;
  error: string | null;
  isConnected: (containerId: string) => boolean;
  startWatching: (containerId: string) => void;
  stopWatching: (containerId: string) => void;
}

const ContainerStatsContext = createContext<ContainerStatsContextType | null>(null);

interface ContainerStatsProviderProps {
  children: ReactNode;
}

export const ContainerStatsProvider: React.FC<ContainerStatsProviderProps> = ({ children }) => {
  // Keeping these state variables for future use in the context value
  const [isLoading] = useState<boolean>(false);
  const [error] = useState<string | null>(null);
  const [stats, setStats] = useState<Record<string, ContainerStats>>({});
  const [connections, setConnections] = useState<Record<string, boolean>>({});
  
  // Refs to track WebSocket instances and timeouts
  const wsRefs = useRef<Record<string, WebSocket>>({});
  const reconnectTimeouts = useRef<Record<string, NodeJS.Timeout>>({});
  const watchCounts = useRef<Record<string, number>>({});
  const isMounted = useRef(true);

  // Log function for debugging
  const log = useCallback((message: string, data?: any) => {
    if (process.env.NODE_ENV === 'development') {
      const timestamp = new Date().toISOString();
      console.log(`[${timestamp}] ${message}`, data || '');
    }
  }, []);

  // Cleanup function for WebSocket connection
  const cleanupConnection = useCallback((containerId: string) => {
    log(`Cleaning up connection for container ${containerId}`);
    
    // Clear any pending reconnection
    if (reconnectTimeouts.current[containerId]) {
      log(`Clearing reconnect timeout for container ${containerId}`);
      clearTimeout(reconnectTimeouts.current[containerId]);
      delete reconnectTimeouts.current[containerId];
    }

    // Close WebSocket if it exists
    const ws = wsRefs.current[containerId];
    if (ws) {
      log(`Closing WebSocket for container ${containerId}, state: ${ws.readyState}`);
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close(1000, 'Cleanup');
      }
      delete wsRefs.current[containerId];
    }

    // Only update state if we're still watching this container
    if (isMounted.current && watchCounts.current[containerId] > 0) {
      log(`Updating connection state to disconnected for container ${containerId}`);
      setConnections(prev => {
        // Only update if not already disconnected to prevent unnecessary re-renders
        if (prev[containerId] !== false) {
          return {
            ...prev,
            [containerId]: false
          };
        }
        return prev;
      });
    }
  }, [log]);

  // Connect to WebSocket
  const connect = useCallback((containerId: string) => {
    log(`Connecting to WebSocket for container ${containerId}`);
    
    // Skip if already connecting/connected
    const existingWs = wsRefs.current[containerId];
    if (existingWs) {
      if (existingWs.readyState === WebSocket.OPEN) {
        log(`WebSocket already connected for container ${containerId}`);
        // Update connection status if not already connected
        setConnections(prev => ({
          ...prev,
          [containerId]: true
        }));
        return;
      }
      if (existingWs.readyState === WebSocket.CONNECTING) {
        log(`WebSocket already connecting for container ${containerId}`);
        return;
      }
    }

    // Clean up any existing connection
    cleanupConnection(containerId);

    try {
      const wsBaseUrl = process.env.REACT_APP_WS_URL || 'ws://localhost:3004';
      const wsUrl = `${wsBaseUrl}/ws/stats/${containerId}`;
      const ws = new WebSocket(wsUrl);
      
      // Store WebSocket reference
      wsRefs.current[containerId] = ws;

      ws.onopen = () => {
        log(`WebSocket connected for container ${containerId}`);
        
        if (isMounted.current) {
          setConnections(prev => {
            // Only update if not already connected to prevent unnecessary re-renders
            if (prev[containerId] !== true) {
              log(`Updating connection status to connected for ${containerId}`);
              return {
                ...prev,
                [containerId]: true
              };
            }
            return prev;
          });
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          log(`Raw WebSocket message for ${containerId}:`, data);
          
          // Handle the case where the payload might be at the root or in a payload property
          const payload = data.payload || data;
          
          if (data.type === 'stats' || payload) {
            const statsData: ContainerStats = {
              id: containerId,
              containerId,
              // Try to get values from payload first, then fall back to root
              cpuUsage: parseFloat(payload.cpuUsage || data.cpuUsage || 0) || 0,
              cpuCount: parseInt(payload.cpuCount || data.cpuCount || 1) || 1,
              memoryUsage: parseFloat(payload.memoryUsage || data.memoryUsage || 0) || 0,
              memoryLimit: parseFloat(payload.memoryLimit || data.memoryLimit || 0) || 0,
              memoryPercent: parseFloat(payload.memoryPercent || data.memoryPercent || 0) || 0,
              networkRx: parseFloat(payload.networkRx || data.networkRx || 0) || 0,
              networkTx: parseFloat(payload.networkTx || data.networkTx || 0) || 0,
              blockRead: parseFloat(payload.blockRead || data.blockRead || 0) || 0,
              blockWrite: parseFloat(payload.blockWrite || data.blockWrite || 0) || 0,
              pids: parseInt(payload.pids || data.pids || 0) || 0,
              timestamp: payload.timestamp || data.timestamp || new Date().toISOString()
            };

            log(`Processed stats for ${containerId}:`, statsData);
            
            if (isMounted.current) {
              setStats(prev => {
                const newStats = {
                  ...prev,
                  [containerId]: statsData
                };
                log(`Updated stats state for ${containerId}:`, newStats);
                return newStats;
              });
              
              // Force a state update to ensure re-render
              setConnections(prev => ({
                ...prev,
                [containerId]: true
              }));
            }
          }
        } catch (error) {
          console.error('Error processing WebSocket message:', error, event.data);
        }
      };

      ws.onclose = (event) => {
        log(`WebSocket closed for container ${containerId}`, { code: event.code, reason: event.reason });
        
        // Only try to reconnect if the component is still mounted and we're watching this container
        if (isMounted.current && watchCounts.current[containerId] > 0) {
          // Only update connection status if this wasn't a clean close
          if (event.code !== 1000) {
            log(`Non-normal closure for container ${containerId}, updating connection status`);
            setConnections(prev => ({
              ...prev,
              [containerId]: false
            }));
          }
          
          const reconnectDelay = 2000; // 2 seconds
          log(`Scheduling reconnection in ${reconnectDelay}ms for container ${containerId}`);
          
          reconnectTimeouts.current[containerId] = setTimeout(() => {
            if (isMounted.current && watchCounts.current[containerId] > 0) {
              log(`Attempting to reconnect to container ${containerId}`);
              connect(containerId);
            } else {
              log(`Skipping reconnection for container ${containerId} - no longer being watched`);
            }
          }, reconnectDelay);
        } else {
          log(`Not reconnecting container ${containerId} - unmounted or not being watched`);
        }
      };

      ws.onerror = (error) => {
        console.error(`WebSocket error for container ${containerId}:`, error);
      };
    } catch (error) {
      console.error(`Failed to create WebSocket for container ${containerId}:`, error);
    }
  }, [cleanupConnection, log]);

  // Start watching a container
  const startWatching = useCallback((containerId: string) => {
    log(`Starting watch for container ${containerId}`);
    
    // Increment watch count
    watchCounts.current[containerId] = (watchCounts.current[containerId] || 0) + 1;
    
    // Connect if not already watching
    if (watchCounts.current[containerId] === 1) {
      connect(containerId);
    }
  }, [connect, log]);

  // Stop watching a container
  const stopWatching = useCallback((containerId: string) => {
    log(`Stopping watch for container ${containerId}`);
    
    // Decrement watch count
    const newCount = Math.max(0, (watchCounts.current[containerId] || 0) - 1);
    watchCounts.current[containerId] = newCount;
    
    // Disconnect if no more watchers
    if (newCount <= 0) {
      cleanupConnection(containerId);
    }
  }, [cleanupConnection, log]);

// Check if a container is connected
const isConnected = useCallback((containerId: string): boolean => {
  const isConnected = !!connections[containerId];
  log(`Connection check for ${containerId}: ${isConnected ? 'Connected' : 'Disconnected'}`);
  return isConnected;
}, [connections, log]);

// Cleanup on unmount
useEffect(() => {
  isMounted.current = true;
  
  return () => {
    isMounted.current = false;
    
    // Clean up all connections
    Object.entries(wsRefs.current).forEach(([containerId, ws]) => {
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        ws.close(1000, 'Component unmounted');
      }
    });
    
    // Clear all timeouts
    Object.entries(reconnectTimeouts.current).forEach(([containerId, timeout]) => {
      if (timeout) {
        clearTimeout(timeout);
      }
    });
  };
}, []);

  // Context value
  const contextValue: ContainerStatsContextType = {
    stats,
    isLoading,
    error,
    isConnected,
    startWatching,
    stopWatching,
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

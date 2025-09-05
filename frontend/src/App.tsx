import React, { useState, useEffect, useRef, useCallback, FC } from 'react';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import { LogEntry, ContainerInfo, LogFilter } from './types/logs';
import LogViewer from './components/LogViewer';
import ContainerList from './components/ContainerList';
import LogFilterBar from './components/LogFilterBar';
import ConnectionStatus from './components/ConnectionStatus';
import { getContainers, getLogs } from './services/api';
import './App.css';

const App: FC = () => {
  const [containers, setContainers] = useState<ContainerInfo[]>([]);
  const [selectedContainer, setSelectedContainer] = useState<string>('all');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<LogFilter>({ level: 'all', search: '', container: 'all' });
  const [connectionStatus, setConnectionStatus] = useState<{
    isConnected: boolean;
    lastMessageTime: number | null;
    connectionError: string | null;
  }>({
    isConnected: false,
    lastMessageTime: null,
    connectionError: null
  });
  
  const wsRef = useRef<WebSocket | null>(null);
  const [reconnectAttempts, setReconnectAttempts] = useState<number>(0);
  const maxReconnectAttempts: number = 5;
  const lastMessageTimeRef = useRef<number | null>(null);
  const [filteredLogs, setFilteredLogs] = useState<LogEntry[]>([]);

  const connectWebSocket = useCallback((containerId: string) => {
    // Clean up any existing connection
    if (wsRef.current) {
      wsRef.current.close(1000, 'Switching containers');
      wsRef.current = null;
      setConnectionStatus(prev => ({
        ...prev,
        isConnected: false,
        connectionError: 'Switching containers'
      }));
    }

    if (containerId === 'all') {
      // Don't connect WebSocket for "all" containers
      setConnectionStatus(prev => ({
        ...prev,
        isConnected: false,
        connectionError: 'No active connection (all containers view)'
      }));
      return;
    }

    // Use WebSocket URL from environment variables
    const wsBaseUrl = process.env.REACT_APP_WS_URL || 'ws://localhost:8093';
    // Construct the full WebSocket URL with the correct path
    const wsUrl = `${wsBaseUrl}/api/v1/logs/ws/logs/${containerId}`;
    
    console.log('Connecting WebSocket to:', wsUrl);
    
    try {
      wsRef.current = new WebSocket(wsUrl);
      
      // Add connection timeout
      const connectionTimeout = setTimeout(() => {
        if (wsRef.current && wsRef.current.readyState !== WebSocket.OPEN) {
          console.log('WebSocket connection timeout');
          wsRef.current.close();
          throw new Error('Connection timeout');
        }
      }, 5000);

      wsRef.current.onopen = () => {
        clearTimeout(connectionTimeout);
        console.log(`WebSocket connected for container: ${containerId}`);
        setConnectionStatus({
          isConnected: true,
          lastMessageTime: Date.now(),
          connectionError: null
        });
        setReconnectAttempts(0);
        lastMessageTimeRef.current = Date.now();
        
        // Send initial heartbeat
        wsRef.current?.send(JSON.stringify({ type: 'heartbeat' }));
      };

      wsRef.current.onmessage = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          const currentTime = Date.now();
          lastMessageTimeRef.current = currentTime;
          
          setConnectionStatus(prev => ({
            ...prev,
            lastMessageTime: currentTime
          }));
          
          // Handle connection established message
          if (data.type === 'connection_established') {
            console.log('WebSocket connection established:', data.message);
            return;
          }
          
          // Handle heartbeat acknowledgment
          if (data.type === 'heartbeat_ack') {
            console.debug('Received heartbeat ack');
            return;
          }
          
          // Handle log entries
          setLogs(prevLogs => {
            const newLogs = [...prevLogs, data];
            // Keep only the last 1000 logs to prevent memory issues
            return newLogs.slice(-1000);
          });
        } catch (error) {
          console.error('Error processing WebSocket message:', error);
        }
      };

      wsRef.current.onclose = (event: CloseEvent) => {
        clearTimeout(connectionTimeout);
        console.log(`WebSocket disconnected for container: ${containerId}`, event);
        
        const errorMessage = event.reason || `Connection closed with code ${event.code}${event.wasClean ? ' (clean)' : ''}`;
        
        setConnectionStatus({
          isConnected: false,
          lastMessageTime: lastMessageTimeRef.current,
          connectionError: errorMessage
        });
        
        // Don't try to reconnect if this was a normal closure
        if (event.code === 1000) {
          console.log('WebSocket closed normally');
          return;
        }
        
        // Attempt to reconnect with exponential backoff
        if (reconnectAttempts < maxReconnectAttempts) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
          const nextAttempt = reconnectAttempts + 1;
          setReconnectAttempts(nextAttempt);
          
          console.log(`Attempting to reconnect (${nextAttempt}/${maxReconnectAttempts}) in ${delay}ms`);
          
          setTimeout(() => {
            if (wsRef.current?.readyState !== WebSocket.OPEN) {
              connectWebSocket(containerId);
            }
          }, delay);
        } else {
          console.error('Max reconnection attempts reached');
          setConnectionStatus(prev => ({
            ...prev,
            connectionError: 'Connection failed after multiple attempts'
          }));
        }
      };

      wsRef.current.onerror = (error) => {
        console.error('WebSocket error:', error);
        setConnectionStatus(prev => ({
          ...prev,
          isConnected: false,
          connectionError: 'WebSocket error occurred'
        }));
      };
    } catch (error) {
      console.error('Error creating WebSocket:', error);
      setConnectionStatus(prev => ({
        ...prev,
        isConnected: false,
        connectionError: 'Failed to create WebSocket connection'
      }));
    }
  }, [reconnectAttempts, maxReconnectAttempts]);

  // WebSocket connection effect
  useEffect(() => {
    if (selectedContainer) {
      console.log('Selected container changed:', selectedContainer);
      connectWebSocket(selectedContainer);
    }
    
    return () => {
      console.log('Cleaning up WebSocket connection');
      if (wsRef.current) {
        wsRef.current.onclose = null; // Prevent reconnection on unmount
        if (wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.close(1000, 'Component unmounting');
        }
        wsRef.current = null;
        setConnectionStatus(prev => ({
          ...prev,
          isConnected: false
        }));
      }
    };
  }, [selectedContainer, connectWebSocket]);

  const loadContainers = useCallback(async () => {
    try {
      setIsLoading(true);
      const data = await getContainers();
      setContainers(data);
      setError(null);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load containers';
      setError(errorMessage);
      console.error('Error loading containers:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadContainers();
    const interval = setInterval(loadContainers, 30000);
    return () => clearInterval(interval);
  }, [loadContainers]);

  useEffect(() => {
    if (selectedContainer === 'all') {
      setLogs([]);
      setIsLoading(false);
      return;
    }

    const loadInitialLogs = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const initialLogs = await getLogs(selectedContainer, 100);
        setLogs(initialLogs || []);
      } catch (err) {
        console.error('Error loading initial logs:', err);
        setError('Failed to load logs for container');
        setLogs([]); // Clear logs on error
      } finally {
        setIsLoading(false);
      }
    };

    loadInitialLogs();
  }, [selectedContainer]);

  const handleContainerSelect = useCallback((containerId: string): void => {
    setSelectedContainer(containerId);
    setLogs([]); // Clear logs when switching containers
  }, []);

  const handleRefresh = useCallback(() => {
    loadContainers();
  }, [loadContainers]);

  // Apply filters to logs
  useEffect(() => {
    let filtered = logs;
    
    // Filter by log level
    if (filter.level !== 'all') {
      filtered = filtered.filter(log => log.level?.toLowerCase() === filter.level.toLowerCase());
    }
    
    // Filter by search term
    if (filter.search) {
      const searchTerm = filter.search.toLowerCase();
      filtered = filtered.filter(log => 
        log.message?.toLowerCase().includes(searchTerm) ||
        log.container?.toLowerCase().includes(searchTerm)
      );
    }
    
    setFilteredLogs(filtered);
  }, [logs, filter]);

  return (
    <div className="app bg-dark text-light vh-100 d-flex flex-column">
      {/* Header */}
      <header className="bg-dark border-bottom border-secondary py-2 flex-shrink-0">
        <div className="container-fluid">
          <div className="row align-items-center">
            <div className="col-md-6">
              <h1 className="h4 mb-0 text-primary">
                <i className="bi bi-layers me-2"></i>
                ERP Docker Log Viewer
              </h1>
              <small className="text-muted">Real-time container log monitoring</small>
            </div>
            <div className="col-md-6 text-end">
              <ConnectionStatus 
                isConnected={connectionStatus.isConnected} 
                lastMessageTime={connectionStatus.lastMessageTime || undefined}
                connectionError={connectionStatus.connectionError || undefined}
              />
              <button 
                className="btn btn-outline-primary btn-sm ms-2"
                onClick={handleRefresh}
                disabled={isLoading}
              >
                <i className="bi bi-arrow-clockwise me-1"></i>
                Refresh
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content Area - Added main-content class */}
      <div className="main-content">
        <div className="container-fluid flex-grow-1 d-flex">
          <div className="row flex-grow-1 g-0 w-100">
            {/* Sidebar */}
            <div className="col-lg-3 col-md-4 border-end border-secondary bg-dark d-flex flex-column">
              <div className="p-3 flex-grow-1" style={{ overflowY: 'auto' }}>
                <ContainerList 
                  containers={containers}
                  selectedContainer={selectedContainer}
                  onSelectContainer={handleContainerSelect}
                  onRefresh={loadContainers}
                />
              </div>
            </div>

            {/* Main Content - Added log-container class */}
            <div className="log-container col-lg-9 col-md-8 d-flex flex-column">
              {/* Log Filter Bar - Added log-filter-bar class */}
              <div className="log-filter-bar">
                <LogFilterBar 
                  filter={filter}
                  onFilterChange={(nf) => setFilter(prev => ({ ...prev, ...nf }))}
                  containerId={selectedContainer}
                />
              </div>
              
              {/* Log Viewer Wrapper - Added log-viewer-wrapper class */}
              <div className="log-viewer-wrapper flex-grow-1">
                {error ? (
                  <div className="d-flex justify-content-center align-items-center h-100">
                    <div className="text-center">
                      <div className="alert alert-danger" role="alert">
                        <i className="bi bi-exclamation-triangle me-2"></i>
                        {error}
                      </div>
                      <button 
                        className="btn btn-primary"
                        onClick={handleRefresh}
                      >
                        Try Again
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Log Viewer - Added log-viewer class */
                  <div className="log-viewer">
                    <LogViewer 
                      logs={filteredLogs}
                      selectedContainer={selectedContainer}
                      isLoading={isLoading}
                      isConnected={connectionStatus.isConnected}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
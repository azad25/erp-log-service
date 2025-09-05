import React, { useState, useEffect, useRef, useCallback } from 'react';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import { LogEntry, ContainerInfo, LogFilter } from './types/logs';
import LogViewer from './components/LogViewer';
import ContainerList from './components/ContainerList';
import LogFilterBar from './components/LogFilterBar';
import ConnectionStatus from './components/ConnectionStatus';
import { getContainers, getLogs } from './services/api';
import './App.css';


const App: React.FC = () => {
  const [containers, setContainers] = useState<ContainerInfo[]>([]);
  const [selectedContainer, setSelectedContainer] = useState<string>('all');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<LogFilter>({ level: 'all', search: '', container: 'all' });
  const [isConnected, setIsConnected] = useState<boolean>(false);
  
  const wsRef = useRef<WebSocket | null>(null);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const maxReconnectAttempts = 5;

  const connectWebSocket = useCallback((containerId: string) => {
    // Clean up any existing connection
    if (wsRef.current) {
      wsRef.current.close(1000, 'Switching containers');
      wsRef.current = null;
      setIsConnected(false);
    }

    if (containerId === 'all') {
      // Don't connect WebSocket for "all" containers
      setIsConnected(false);
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
        setIsConnected(true);
        setReconnectAttempts(0);
        
        // Send initial heartbeat
        wsRef.current?.send(JSON.stringify({ type: 'heartbeat' }));
      };

      wsRef.current.onmessage = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          
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
        setIsConnected(false);
        
        // Don't try to reconnect if this was a normal closure
        if (event.code === 1000) {
          console.log('WebSocket closed normally');
          return;
        }
        
        // Attempt to reconnect with exponential backoff
        if (reconnectAttempts < maxReconnectAttempts) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
          setReconnectAttempts(prev => prev + 1);
          
          console.log(`Attempting to reconnect (${reconnectAttempts + 1}/${maxReconnectAttempts}) in ${delay}ms`);
          
          setTimeout(() => {
            if (wsRef.current?.readyState !== WebSocket.OPEN) {
              connectWebSocket(containerId);
            }
          }, delay);
        } else {
          console.error('Max reconnection attempts reached');
        }
      };

      wsRef.current.onerror = (error: Event) => {
        console.error('WebSocket error:', error);
      };
      
    } catch (error) {
      console.error('Error creating WebSocket:', error);
      setIsConnected(false);
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
        setIsConnected(false);
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

  const filteredLogs = logs.filter(log => {
    if (filter.container !== 'all' && log.container !== filter.container) return false;
    if (filter.level !== 'all' && log.level && log.level.toLowerCase() !== filter.level.toLowerCase()) return false;
    if (filter.search) {
      const s = filter.search.toLowerCase();
      if (!((log.message || '').toLowerCase().includes(s) || (log.container || '').toLowerCase().includes(s))) {
        if (log.raw) return JSON.stringify(log.raw).toLowerCase().includes(s);
        return false;
      }
    }
    return true;
  });

  const handleRefresh = async () => {
    try {
      setIsLoading(true);
      await loadContainers();
      if (selectedContainer !== 'all') {
        const initialLogs = await getLogs(selectedContainer, 100);
        setLogs(initialLogs || []);
      } else {
        setLogs([]);
      }
    } catch (err) {
      console.error('Error refreshing:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleContainerSelect = (containerId: string) => {
    setSelectedContainer(containerId);
    setLogs([]); // Clear logs when switching containers
  };

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
              <ConnectionStatus isConnected={isConnected} />
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

      {/* Main Content Area */}
      <div className="container-fluid flex-grow-1 d-flex overflow-hidden">
        <div className="row flex-grow-1 g-0">
          {/* Sidebar */}
          <div className="col-lg-3 col-md-4 border-end border-secondary bg-dark d-flex flex-column">
            <div className="p-3 flex-grow-1 overflow-auto">
              <ContainerList 
                containers={containers}
                selectedContainer={selectedContainer}
                onSelectContainer={handleContainerSelect}
                onRefresh={loadContainers}
              />
            </div>
          </div>

          {/* Main Content */}
          <div className="col-lg-9 col-md-8 d-flex flex-column">
            <LogFilterBar 
              filter={filter}
              onFilterChange={(nf) => setFilter(prev => ({ ...prev, ...nf }))}
              containerId={selectedContainer}
            />
            
            <div className="flex-grow-1 overflow-hidden">
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
                <LogViewer 
                  logs={filteredLogs}
                  selectedContainer={selectedContainer}
                  isLoading={isLoading}
                  isConnected={isConnected}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;

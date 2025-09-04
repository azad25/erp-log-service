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
  const [isLoadingContainers, setIsLoadingContainers] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<LogFilter>({ level: 'all', search: '', container: 'all' });
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [socket, setSocket] = useState<WebSocket | null>(null);

  const logBuffer = useRef<LogEntry[]>([]);
  const bufferTimeout = useRef<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const maxReconnectAttempts = 5;

  const handleNewLog = useCallback((log: LogEntry) => {
    setLogs(prevLogs => {
      const newLogs = [...prevLogs, log].slice(-1000); // Keep latest 1000 logs
      return newLogs;
    });
  }, []);

  const connectWebSocket = useCallback((containerId: string) => {
    if (wsRef.current) {
      wsRef.current.close();
    }

    if (containerId === 'all') {
      // Don't connect WebSocket for "all" containers
      setIsConnected(false);
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}/api/v1/logs/ws/logs/${containerId}`;
    
    console.log('Connecting WebSocket to:', wsUrl);
    wsRef.current = new WebSocket(wsUrl);

    wsRef.current.onopen = () => {
      console.log(`WebSocket connected for container: ${containerId}`);
      setIsConnected(true);
      setReconnectAttempts(0);
    };

    wsRef.current.onmessage = (event: MessageEvent) => {
      try {
        const logEntry = JSON.parse(event.data);
        setLogs(prevLogs => {
          const newLogs = [...prevLogs, logEntry];
          // Keep only the last 1000 logs to prevent memory issues
          return newLogs.slice(-1000);
        });
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };

    wsRef.current.onclose = () => {
      console.log(`WebSocket disconnected for container: ${containerId}`);
      setIsConnected(false);
      
      // Attempt to reconnect with exponential backoff
      if (reconnectAttempts < maxReconnectAttempts) {
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
        setReconnectAttempts(prev => prev + 1);
        
        setTimeout(() => {
          console.log(`Attempting to reconnect (${reconnectAttempts + 1}/${maxReconnectAttempts})`);
          connectWebSocket(containerId);
        }, delay);
      }
    };

    wsRef.current.onerror = (error: Event) => {
      console.error(`WebSocket error for container ${containerId}:`, error);
    };
  }, [reconnectAttempts, maxReconnectAttempts]);

  // WebSocket connection effect
  useEffect(() => {
    connectWebSocket(selectedContainer);
    
    return () => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.close(1000, 'Component unmounting');
      }
    };
  }, [selectedContainer, connectWebSocket]);

  const loadContainers = useCallback(async () => {
    try {
      setIsLoadingContainers(true);
      const data = await getContainers();
      setContainers(data || []);
      setError(null);
    } catch (err) {
      console.error('Error loading containers:', err);
      setError('Failed to load containers. Please try again.');
    } finally {
      setIsLoadingContainers(false);
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
    <div className="app bg-dark text-light min-vh-100">
      {/* Header */}
      <header className="bg-dark border-bottom border-secondary py-3">
        <div className="container-fluid">
          <div className="row align-items-center">
            <div className="col-md-6">
              <h1 className="h3 mb-0 text-primary">
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

      <div className="container-fluid h-100">
        <div className="row h-100">
          {/* Sidebar */}
          <div className="col-lg-3 col-md-4 border-end border-secondary bg-dark" style={{ height: 'calc(100vh - 80px)', overflowY: 'auto' }}>
            <div className="p-3">
              <ContainerList 
                containers={containers}
                selectedContainer={selectedContainer}
                onSelectContainer={handleContainerSelect}
                onRefresh={loadContainers}
              />
            </div>
          </div>

          {/* Main Content */}
          <div className="col-lg-9 col-md-8 p-0">
            <div className="h-100 d-flex flex-column">
              <LogFilterBar 
                filter={filter}
                onFilterChange={(nf) => setFilter(prev => ({ ...prev, ...nf }))}
                containerId={selectedContainer}
              />
              
              <div className="flex-grow-1" style={{ height: 'calc(100vh - 160px)' }}>
                {error ? (
                  <div className="p-4 text-center">
                    <div className="alert alert-danger" role="alert">
                      <i className="bi bi-exclamation-triangle me-2"></i>
                      {error}
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
    </div>
  );
};

export default App;

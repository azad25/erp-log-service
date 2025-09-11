import React, { useState, useEffect, useCallback, FC } from 'react';
import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import { LogEntry, ContainerInfo, LogFilter } from './types/logs';
import LogViewer from './components/LogViewer';
import ContainerList from './components/ContainerList';
import LogFilterBar from './components/LogFilterBar';
import ConnectionStatus from './components/ConnectionStatus';
import { WebSocketProvider } from './contexts/WebSocketContext';
import { ContainerStatsProvider } from './contexts/ContainerStatsContext';
import { getContainers } from './services/api';
import './App.css';

// Main App Component with WebSocket integration
const AppContent: FC = () => {
  const [containers, setContainers] = useState<ContainerInfo[]>([]);
  const [selectedContainer, setSelectedContainer] = useState<string>('all');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<LogFilter>({ level: 'all', search: '', container: 'all' });
  // Removed filteredLogs state since LogViewer handles filtering internally
  
  // Remove WebSocket hook from App.tsx since LogViewer now handles it directly


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


  const handleContainerSelect = useCallback((containerId: string): void => {
    setSelectedContainer(containerId);
  }, []);

  const handleRefresh = useCallback(() => {
    loadContainers();
  }, [loadContainers]);

  // Removed filter logic since LogViewer handles filtering internally

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
                isConnected={true} 
                lastMessageTime={Date.now()}
                connectionError={undefined}
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
                      selectedContainer={selectedContainer}
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

// App wrapper with providers
const App: FC = () => {
  const handleLogMessage = useCallback((log: LogEntry, containerId: string) => {
    // Log message handling is now done in the WebSocket context
  }, []);

  return (
    <ContainerStatsProvider>
      <WebSocketProvider onMessage={handleLogMessage}>
        <AppContent />
      </WebSocketProvider>
    </ContainerStatsProvider>
  );
};

export default App;
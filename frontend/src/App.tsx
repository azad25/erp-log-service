import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  AppBar, 
  Toolbar, 
  Typography, 
  Box, 
  CssBaseline, 
  Paper, 
  IconButton, 
  Tooltip, 
  CircularProgress,
  Drawer,
  Alert,
  Snackbar,
  useMediaQuery
} from '@mui/material';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { blue } from '@mui/material/colors';
import SettingsIcon from '@mui/icons-material/Settings';
import RefreshIcon from '@mui/icons-material/Refresh';
import MenuIcon from '@mui/icons-material/Menu';
import { LogEntry, ContainerInfo, LogFilter } from './types/logs';
import LogViewer from './components/LogViewer';
import ContainerList from './components/ContainerList';
import { getContainers, getLogs } from './services/api';
import { WebSocketProvider, useWebSocket } from './contexts/WebSocketContext';

const theme = createTheme({
  palette: {
    primary: blue,
    mode: 'dark',
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: '#121212',
          color: '#e0e0e0',
        },
      },
    },
  },
});

const DRAWER_WIDTH = 280;

const App: React.FC = () => {
  // State management
  const [containers, setContainers] = useState<ContainerInfo[]>([]);
  const [selectedContainer, setSelectedContainer] = useState<string>('all');
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoadingContainers, setIsLoadingContainers] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState<boolean>(false);
  const [snackbar, setSnackbar] = useState<{ 
    open: boolean; 
    message: string; 
    severity: 'success' | 'error' | 'info' | 'warning' 
  }>({ 
    open: false, 
    message: '', 
    severity: 'info' 
  });
  const [filter, setFilter] = useState<LogFilter>({
    level: 'all',
    search: '',
    container: 'all',
  });

  // Hooks
  const isMobile = useMediaQuery('(max-width: 900px)');
  const { isConnected } = useWebSocket();
  const logBuffer = useRef<LogEntry[]>([]);
  const bufferTimeout = useRef<NodeJS.Timeout | null>(null);

  // Helper functions
  const showSnackbar = useCallback((message: string, severity: 'success' | 'error' | 'info' | 'warning' = 'info') => {
    setSnackbar({ open: true, message, severity });
  }, []);

  const handleCloseSnackbar = useCallback(() => {
    setSnackbar(prev => ({ ...prev, open: false }));
  }, []);

  const handleDrawerToggle = useCallback(() => {
    setMobileOpen(prev => !prev);
  }, []);

  // Load containers effect
  useEffect(() => {
    const loadContainers = async () => {
      try {
        setIsLoadingContainers(true);
        const data = await getContainers();
        setContainers(data);
        setError(null);
        
        if (selectedContainer === 'all' && data.length > 0) {
          setSelectedContainer(data[0].id);
        }
      } catch (err) {
        console.error('Error loading containers:', err);
        setError('Failed to load containers. Please try again.');
        showSnackbar('Failed to load containers', 'error');
      } finally {
        setIsLoadingContainers(false);
      }
    };
    
    loadContainers();
    
    const interval = setInterval(loadContainers, 30000);
    return () => clearInterval(interval);
  }, [selectedContainer, showSnackbar]);
  
  // Load logs effect
  useEffect(() => {
    if (selectedContainer === 'all') {
      setLogs([]);
      return;
    }
    
    const loadInitialLogs = async () => {
      try {
        setIsLoading(true);
        const containerLogs = await getLogs(selectedContainer, 100);
        setLogs(containerLogs);
      } catch (err) {
        console.error(`Error loading logs for container ${selectedContainer}:`, err);
        showSnackbar('Failed to load logs for container', 'error');
      } finally {
        setIsLoading(false);
      }
    };
    
    loadInitialLogs();
  }, [selectedContainer, showSnackbar]);
  
  // WebSocket message handler
  const handleWebSocketMessage = useCallback((log: LogEntry) => {
    if (selectedContainer !== 'all' && log.container !== selectedContainer) {
      return;
    }
    
    logBuffer.current = [log, ...logBuffer.current].slice(0, 1000);
    
    if (!bufferTimeout.current) {
      bufferTimeout.current = setTimeout(() => {
        setLogs(prevLogs => {
          const mergedLogs = [...logBuffer.current];
          const existingTimestamps = new Set(prevLogs.map(l => `${l.timestamp}-${l.message}`));
          
          for (const logItem of prevLogs) {
            const logKey = `${logItem.timestamp}-${logItem.message}`;
            if (!existingTimestamps.has(logKey)) {
              mergedLogs.push(logItem);
            }
          }
          
          return mergedLogs
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
            .slice(0, 1000);
        });
        
        logBuffer.current = [];
        bufferTimeout.current = null;
      }, 100);
    }
  }, [selectedContainer]);
      } catch (err) {
        console.error('Error loading containers:', err);
        setError('Failed to load containers. Please check if the backend is running.');
      } finally {
        setIsLoading(false);
      }
    };

    loadContainers();
  }, []);

  // Load initial logs when container changes
  useEffect(() => {
    if (selectedContainer === 'all') {
      // For 'all' containers, we'll rely on WebSocket updates
      setLogs([]);
      return;
    }

    const loadInitialLogs = async () => {
      try {
        setIsLoading(true);
        const initialLogs = await getLogs(selectedContainer, 100);
        setLogs(prevLogs => [...initialLogs, ...prevLogs].slice(-1000));
      } catch (err) {
        console.error('Error loading initial logs:', err);
      } finally {
        setIsLoading(false);
      }
    };

    loadInitialLogs();
  }, [selectedContainer]);

  // Handle new log entry from WebSocket
  const handleNewLog = useCallback((log: LogEntry) => {
    setLogs(prevLogs => {
      // Limit logs to prevent memory issues
      const newLogs = [log, ...prevLogs];
      if (newLogs.length > 1000) {
        return newLogs.slice(0, 1000);
      }
      return newLogs;
    });
  }, []);

  // Filter logs based on current filter
  const filteredLogs = logs.filter(log => {
    // Filter by container
    if (filter.container !== 'all' && log.container !== filter.container) {
      return false;
    }
    
    // Filter by level
    if (filter.level !== 'all' && log.level.toLowerCase() !== filter.level.toLowerCase()) {
      return false;
    }
    
    // Filter by search term
    if (filter.search) {
      const searchLower = filter.search.toLowerCase();
      return (
        log.message.toLowerCase().includes(searchLower) ||
        log.container.toLowerCase().includes(searchLower) ||
        log.level.toLowerCase().includes(searchLower) ||
        log.raw.toLowerCase().includes(searchLower)
      );
    }
    
    return true;
  });

  const handleContainerSelect = (containerId: string) => {
    setSelectedContainer(containerId);
  };

  const handleFilterChange = (newFilter: Partial<LogFilter>) => {
    setFilter(prev => ({
      ...prev,
      ...newFilter,
    }));
  };

  const handleRefresh = async () => {
    try {
      setIsLoading(true);
      const data = await getContainers();
      setContainers(data);
      
      if (selectedContainer !== 'all') {
        const initialLogs = await getLogs(selectedContainer, 100);
        setLogs(initialLogs);
      } else {
        setLogs([]);
      }
      
      setError(null);
    } catch (err) {
      console.error('Error refreshing:', err);
      setError('Failed to refresh data. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  loadInitialLogs();
}, [selectedContainer]);

// Handle new log entry from WebSocket
const handleNewLog = useCallback((log: LogEntry) => {
  setLogs(prevLogs => {
    // Limit logs to prevent memory issues
    const newLogs = [log, ...prevLogs];
    if (newLogs.length > 1000) {
      return newLogs.slice(0, 1000);
    }
    return newLogs;
  });
}, []);

// Filter logs based on filter criteria
const filteredLogs = logs.filter(log => {
  // Filter by log level
  if (filter.level !== 'all' && log.level && !log.level.toLowerCase().includes(filter.level.toLowerCase())) {
    return false;
  }
  
  // Filter by search term
  if (filter.search) {
    const searchLower = filter.search.toLowerCase();
    const logMessage = log.message?.toLowerCase() || '';
    const logContainer = log.container?.toLowerCase() || '';
    
    if (!logMessage.includes(searchLower) && !logContainer.includes(searchLower)) {
      // Also search in extra fields if they exist
      if (log.extra) {
        const extraString = JSON.stringify(log.extra).toLowerCase();
        if (!extraString.includes(searchLower)) {
          return false;
        }
      } else {
        return false;
      }
    }
  }
  
  return true;
});

// Handle refresh
const handleRefresh = async () => {
  try {
    setIsLoading(true);
    if (selectedContainer === 'all') {
      setLogs([]);
    } else {
      const containerLogs = await getLogs(selectedContainer, 100);
      setLogs(containerLogs);
    }
    showSnackbar('Logs refreshed', 'success');
  } catch (err) {
    console.error('Error refreshing logs:', err);
    showSnackbar('Failed to refresh logs', 'error');
  } finally {
    setIsLoading(false);
  }
};

return (
  <ThemeProvider theme={theme}>
    <WebSocketProvider onMessage={handleNewLog}>
      <CssBaseline />
      <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
        <AppBar 
          position="fixed" 
          color="primary" 
          elevation={0}
          sx={{
            width: { sm: `calc(100% - ${DRAWER_WIDTH}px)` },
            ml: { sm: `${DRAWER_WIDTH}px` },
            zIndex: (theme) => theme.zIndex.drawer + 1,
          }}
        >
          <Toolbar>
            <IconButton
              color="inherit"
              aria-label="open drawer"
              edge="start"
              onClick={handleDrawerToggle}
              sx={{ mr: 2, display: { sm: 'none' } }}
            >
              <MenuIcon />
            </IconButton>
            
            <Typography variant="h6" noWrap component="div" sx={{ flexGrow: 1 }}>
              Docker Log Viewer
            </Typography>
            
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box 
                sx={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  bgcolor: isConnected ? 'success.main' : 'error.main',
                  mr: 1,
                }}
              />
              <Typography variant="caption" sx={{ mr: 2, display: { xs: 'none', sm: 'block' } }}>
                {isConnected ? 'Connected' : 'Disconnected'}
              </Typography>
              
              <Tooltip title="Refresh">
                <IconButton 
                  color="inherit" 
                  onClick={handleRefresh}
                  disabled={isLoading}
                >
                  <RefreshIcon />
                </IconButton>
              </Tooltip>
              
              <Tooltip title="Settings">
                <IconButton color="inherit">
                  <SettingsIcon />
                </IconButton>
              </Tooltip>
            </Box>
          </Toolbar>
        </AppBar>
        
        <Box sx={{ display: 'flex', flexGrow: 1, overflow: 'hidden', pt: 8 }}>
          {/* Sidebar Drawer */}
          <Box
            component="nav"
            sx={{ width: { sm: DRAWER_WIDTH }, flexShrink: { sm: 0 } }}
            aria-label="containers list"
          >
            <Drawer
              variant="temporary"
              open={mobileOpen}
              onClose={handleDrawerToggle}
              ModalProps={{
                keepMounted: true, // Better open performance on mobile
              }}
              sx={{
                display: { xs: 'block', sm: 'none' },
                '& .MuiDrawer-paper': { 
                  boxSizing: 'border-box',
                  width: DRAWER_WIDTH,
                  bgcolor: 'background.paper',
                  borderRight: 1,
                  borderColor: 'divider',
                },
              }}
            >
              <Box sx={{ p: 2, height: '100%', overflowY: 'auto' }}>
                <ContainerList 
                  containers={containers} 
                  selectedContainer={selectedContainer}
                  onSelectContainer={(id) => {
                    setSelectedContainer(id);
                    if (isMobile) setMobileOpen(false);
                  }}
                  isLoading={isLoadingContainers}
                />
              </Box>
            </Drawer>
            
            <Drawer
              variant="permanent"
              sx={{
                display: { xs: 'none', sm: 'block' },
                '& .MuiDrawer-paper': { 
                  boxSizing: 'border-box',
                  width: DRAWER_WIDTH,
                  bgcolor: 'background.paper',
                  borderRight: 1,
                  borderColor: 'divider',
                  pt: '64px', // Account for AppBar height
                },
              }}
              open
            >
              <ContainerList 
                containers={containers} 
                selectedContainer={selectedContainer}
                onSelectContainer={setSelectedContainer}
                isLoading={isLoadingContainers}
              />
            </Drawer>
          </Box>
          
          {/* Main Content */}
          <Box 
            component="main"
            sx={{
              flexGrow: 1,
              p: 3,
              width: { sm: `calc(100% - ${DRAWER_WIDTH}px)` },
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <Paper 
              elevation={0}
              sx={{
                flexGrow: 1,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                bgcolor: 'background.paper',
                borderRadius: 1,
                border: 1,
                borderColor: 'divider',
              }}
            >
              <LogFilterBar 
                filter={filter}
                onFilterChange={(newFilter) => setFilter(prev => ({ ...prev, ...newFilter }))}
                containerId={selectedContainer}
              />
              
              <Box sx={{ flexGrow: 1, overflow: 'hidden' }}>
                {error ? (
                  <Box sx={{ p: 3, textAlign: 'center' }}>
                    <Typography color="error">{error}</Typography>
                  }}>
                    <CircularProgress />
                  </Box>
                )}
                
                <LogViewer 
                  logs={filteredLogs} 
                  selectedContainer={selectedContainer}
                  isLoading={isLoading}
                />
              </Box>
            </Box>
          </Box>
        </Box>
      </WebSocketProvider>
    </ThemeProvider>
  );
};

export default App;

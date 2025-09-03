import React, { useState } from 'react';
import {
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Checkbox,
  ListItemSecondaryAction,
  IconButton,
  Tooltip,
  Box,
  Divider,
  Chip,
  Typography,
  Collapse,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton as MuiIconButton,
  Paper,
  useTheme,
  useMediaQuery
} from '@mui/material';
import {
  PlayArrow as StartIcon,
  Stop as StopIcon,
  Replay as RestartIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  Info as InfoIcon,
  Close as CloseIcon,
  Fullscreen as FullscreenIcon,
  FullscreenExit as FullscreenExitIcon
} from '@mui/icons-material';
import { ContainerInfo } from '../types/containers';
import { getContainerIcon } from '../utils/containerIcons';
import { startContainer, stopContainer, restartContainer } from '../services/containerService';

interface ContainerListProps {
  containers: ContainerInfo[];
  selectedContainer: string;
  onSelectContainer: (containerId: string) => void;
  onRefresh: () => void;
}

const ContainerList: React.FC<ContainerListProps> = ({
  containers,
  selectedContainer,
  onSelectContainer,
  onRefresh
}) => {
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('md'));
  const [logsModalOpen, setLogsModalOpen] = useState(false);
  const [selectedContainerLogs, setSelectedContainerLogs] = useState<ContainerInfo | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [expandedContainer, setExpandedContainer] = useState<string | null>(null);
  const [loadingActions, setLoadingActions] = useState<Record<string, boolean>>({});

  const handleContainerAction = async (
    containerId: string,
    action: 'start' | 'stop' | 'restart'
  ) => {
    try {
      setLoadingActions(prev => ({ ...prev, [containerId]: true }));
      
      switch (action) {
        case 'start':
          await startContainer(containerId);
          break;
        case 'stop':
          await stopContainer(containerId);
          break;
        case 'restart':
          await restartContainer(containerId);
          break;
      }
      
      // Refresh container list after action
      onRefresh();
    } catch (error) {
      console.error(`Error ${action}ing container:`, error);
    } finally {
      setLoadingActions(prev => ({ ...prev, [containerId]: false }));
    }
  };

  const toggleContainerExpand = (containerId: string) => {
    setExpandedContainer(expandedContainer === containerId ? null : containerId);
  };

  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'running':
        return 'success';
      case 'exited':
      case 'dead':
        return 'error';
      case 'restarting':
      case 'paused':
        return 'warning';
      default:
        return 'default';
    }
  };

  const getStatusLabel = (status: string) => {
    return status.charAt(0).toUpperCase() + status.slice(1);
  };

  const handleViewLogs = (container: ContainerInfo) => {
    setSelectedContainerLogs(container);
    setLogsModalOpen(true);
  };

  const handleCloseLogsModal = () => {
    setLogsModalOpen(false);
    setIsFullscreen(false);
  };

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  // Group containers by type (application vs infrastructure)
  const appContainers = containers.filter(c => !c.isInfra);
  const infraContainers = containers.filter(c => c.isInfra);

  const renderContainerItem = (container: ContainerInfo) => {
    const isExpanded = expandedContainer === container.id;
    const isRunning = container.status.toLowerCase() === 'running';
    const isLoading = loadingActions[container.id];

    return (
      <React.Fragment key={container.id}>
        <ListItem
          button
          onClick={() => onSelectContainer(container.id)}
          selected={selectedContainer === container.id}
        >
          <ListItemIcon>
            <Checkbox
              edge="start"
              checked={selectedContainer === container.id}
              tabIndex={-1}
              disableRipple
            />
          </ListItemIcon>
          <ListItemIcon>
            <Box
              component="span"
              sx={{
                width: 12,
                height: 12,
                borderRadius: '50%',
                bgcolor: getStatusColor(container.status) + '.main',
                mr: 1,
                display: 'inline-block'
          <ListItemButton
            selected={selectedContainer === container.id}
            onClick={() => onSelectContainer(container.id)}
          >
            <ListItemIcon>
              <Avatar sx={{ bgcolor: 'primary.main', width: 24, height: 24 }}>
                {getContainerIcon(container.name)}
              </Avatar>
            </ListItemIcon>
            <ListItemText
              primary={container.name}
              secondary={
                <Box component="span" sx={{ 
                  display: 'inline-block',
                  width: 8, 
                  height: 8, 
                  borderRadius: '50%',
                  bgcolor: container.status === 'running' ? 'success.main' : 'error.main',
                  mr: 0.5
                }} />
              }
              primaryTypographyProps={{
              }}
            />
          </ListItemIcon>
          <ListItemText
            primary={container.name}
            secondary={
              <Box component="span" sx={{ 
                display: 'inline-block',
                width: 8, 
                height: 8, 
                borderRadius: '50%',
                bgcolor: container.status === 'running' ? 'success.main' : 'error.main',
                mr: 0.5
              }} />
            }
            primaryTypographyProps={{
              variant: 'body2',
              noWrap: true,
              title: container.name,
            }}
            secondaryTypographyProps={{ component: 'span' }}
          />
          <ListItemSecondaryAction>
            <Tooltip title="View Full Logs">
              <IconButton
                edge="end"
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  handleViewLogs(container);
                }}
              >
                <FullscreenIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </ListItemSecondaryAction>
        </ListItem>
      </React.Fragment>
    );
  };

  return (
    <List>
      {containers.map(renderContainerItem)}
      
      {/* Logs Modal */}
      <Dialog
        fullScreen={fullScreen || isFullscreen}
        open={logsModalOpen}
        onClose={handleCloseLogsModal}
        maxWidth="lg"
        fullWidth
        PaperProps={{
          style: {
            height: isFullscreen ? '100vh' : '80vh',
            width: isFullscreen ? '100vw' : '90vw',
            maxWidth: 'none',
            margin: isFullscreen ? 0 : '32px auto',
            borderRadius: isFullscreen ? 0 : theme.shape.borderRadius
          }
        }}
      >
        <DialogTitle sx={{ m: 0, p: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box sx={{ display: 'flex', alignItems: 'center' }}>
            <Typography variant="h6">
              Logs: {selectedContainerLogs?.name}
            </Typography>
            <Chip 
              label={selectedContainerLogs?.status} 
              size="small" 
              color={getStatusColor(selectedContainerLogs?.status || '') as any}
              sx={{ ml: 1 }}
            />
          </Box>
          <Box>
            <Tooltip title={isFullscreen ? 'Exit full screen' : 'Full screen'}>
              <MuiIconButton
                aria-label="fullscreen"
                onClick={toggleFullscreen}
                size="large"
                sx={{ mr: 1 }}
              >
                {isFullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
              </MuiIconButton>
            </Tooltip>
            <MuiIconButton
              aria-label="close"
              onClick={handleCloseLogsModal}
              size="large"
            >
              <CloseIcon />
            </MuiIconButton>
          </Box>
        </DialogTitle>
        <DialogContent dividers sx={{ p: 0, bgcolor: 'background.default' }}>
          <Box sx={{ p: 2, height: '100%', overflow: 'auto' }}>
            {/* Logs content will go here */}
            <Typography variant="body2" color="text.secondary">
              Logs for {selectedContainerLogs?.name} will be displayed here.
              {/* In a real implementation, you would fetch and display the logs here */}
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions sx={{ p: 1, bgcolor: 'background.paper' }}>
          <Button 
            onClick={handleCloseLogsModal} 
            color="primary"
            variant="outlined"
            size="small"
            startIcon={<CloseIcon />}
          >
            Close
          </Button>
          <Button 
            onClick={() => {
              // Handle refresh logs
            }}
            color="primary"
            variant="contained"
            size="small"
            startIcon={<ReplayIcon />}
          >
            Refresh Logs
          </Button>
        </DialogActions>
      </Dialog>
    </List>
  );
};

export default ContainerList;

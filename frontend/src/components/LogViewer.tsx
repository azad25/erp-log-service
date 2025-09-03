import React, { useEffect, useRef } from 'react';
import { Box, Typography, Paper, useTheme } from '@mui/material';
import { LogEntry } from '../types/logs';
import { formatTimestamp, getLogLevelColor, formatLogLevel } from '../services/api';

interface LogViewerProps {
  logs: LogEntry[];
  selectedContainer: string;
  isLoading: boolean;
}

const LogViewer: React.FC<LogViewerProps> = ({ logs, selectedContainer, isLoading }) => {
  const theme = useTheme();
  const endOfLogsRef = useRef<HTMLDivElement>(null);
  const prevLogsLength = useRef(0);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (endOfLogsRef.current && (logs.length !== prevLogsLength.current || prevLogsLength.current === 0)) {
      endOfLogsRef.current.scrollIntoView({ behavior: 'smooth' });
      prevLogsLength.current = logs.length;
    }
  }, [logs.length]);

  if (isLoading && logs.length === 0) {
    return (
      <Box sx={{ p: 2, textAlign: 'center' }}>
        <Typography>Loading logs...</Typography>
      </Box>
    );
  }

  if (logs.length === 0) {
    return (
      <Box sx={{ p: 2, textAlign: 'center' }}>
        <Typography variant="body2" color="textSecondary">
          {selectedContainer === 'all' 
            ? 'No logs available. Select a container to view its logs.'
            : 'No logs available for this container.'}
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ 
      height: '100%', 
      overflowY: 'auto',
      p: 1,
      bgcolor: theme.palette.background.default,
    }}>
      {logs.map((log, index) => (
        <Paper 
          key={`${log.timestamp}-${index}`}
          elevation={0}
          sx={{
            mb: 0.5,
            p: 1,
            bgcolor: 'background.paper',
            borderLeft: `3px solid ${getLogLevelColor(log.level)}`,
            '&:hover': {
              bgcolor: 'action.hover',
            },
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'flex-start' }}>
            <Typography 
              variant="caption" 
              sx={{ 
                minWidth: 140, 
                color: 'text.secondary',
                fontFamily: 'monospace',
              }}
            >
              {formatTimestamp(log.timestamp)}
            </Typography>
            
            <Typography 
              variant="caption" 
              sx={{ 
                minWidth: 80, 
                color: getLogLevelColor(log.level),
                fontWeight: 'bold',
                textTransform: 'uppercase',
                fontFamily: 'monospace',
                mr: 1,
              }}
            >
              {formatLogLevel(log.level)}
            </Typography>
            
            {selectedContainer === 'all' && (
              <Typography 
                variant="caption" 
                sx={{ 
                  minWidth: 120, 
                  color: 'primary.main',
                  fontWeight: 'medium',
                  fontFamily: 'monospace',
                  mr: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={log.container}
              >
                {log.container}
              </Typography>
            )}
            
            <Typography 
              variant="body2" 
              component="pre"
              sx={{
                m: 0,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontFamily: 'monospace',
                fontSize: '0.8125rem',
                lineHeight: 1.5,
                flex: 1,
              }}
            >
              {log.message || log.raw}
            </Typography>
          </Box>
          
          {log.extra && Object.keys(log.extra).length > 0 && (
            <Box sx={{ 
              mt: 0.5, 
              ml: 'calc(140px + 80px + 8px)',
              fontSize: '0.75rem',
              color: 'text.secondary',
              fontFamily: 'monospace',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}>
              {JSON.stringify(log.extra, null, 2)}
            </Box>
          )}
        </Paper>
      ))}
      <div ref={endOfLogsRef} />
    </Box>
  );
};

export default LogViewer;

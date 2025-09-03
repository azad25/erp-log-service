import React from 'react';
import { Box, TextField, MenuItem, InputAdornment } from '@mui/material';
import { Search as SearchIcon } from '@mui/icons-material';
import { LogFilter } from '../types/logs';

const LOG_LEVELS = [
  { value: 'all', label: 'All Levels' },
  { value: 'error', label: 'Error' },
  { value: 'warn', label: 'Warning' },
  { value: 'info', label: 'Info' },
  { value: 'debug', label: 'Debug' },
  { value: 'trace', label: 'Trace' },
];

interface LogFilterBarProps {
  filter: LogFilter;
  onFilterChange: (filter: Partial<LogFilter>) => void;
  containerId: string;
}

const LogFilterBar: React.FC<LogFilterBarProps> = ({
  filter,
  onFilterChange,
  containerId,
}) => {
  const handleLevelChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    onFilterChange({ level: event.target.value });
  };

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    onFilterChange({ search: event.target.value });
  };

  return (
    <Box 
      sx={{ 
        p: 1, 
        borderBottom: 1, 
        borderColor: 'divider',
        display: 'flex',
        gap: 1,
        bgcolor: 'background.paper',
      }}
    >
      <TextField
        select
        size="small"
        value={filter.level}
        onChange={handleLevelChange}
        variant="outlined"
        sx={{ minWidth: 150 }}
      >
        {LOG_LEVELS.map((level) => (
          <MenuItem key={level.value} value={level.value}>
            {level.label}
          </MenuItem>
        ))}
      </TextField>

      <TextField
        fullWidth
        size="small"
        placeholder={`Search in ${containerId === 'all' ? 'all containers' : 'this container'}...`}
        value={filter.search}
        onChange={handleSearchChange}
        variant="outlined"
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchIcon fontSize="small" />
            </InputAdornment>
          ),
        }}
      />
    </Box>
  );
};

export default LogFilterBar;

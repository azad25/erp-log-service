import React from 'react';
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
  const handleLevelChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    onFilterChange({ level: event.target.value });
  };

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    onFilterChange({ search: event.target.value });
  };

  return (
    <div className="log-filter-bar bg-dark border-bottom border-secondary p-3">
      <div className="row align-items-center">
        <div className="col-md-3">
          <select 
            className="form-select form-select-sm"
            value={filter.level}
            onChange={handleLevelChange}
          >
            {LOG_LEVELS.map((level) => (
              <option key={level.value} value={level.value}>
                {level.label}
              </option>
            ))}
          </select>
        </div>
        
        <div className="col-md-6">
          <div className="input-group input-group-sm">
            <span className="input-group-text bg-secondary border-secondary">
              <i className="bi bi-search text-light"></i>
            </span>
            <input
              type="text"
              className="form-control bg-dark border-secondary text-light"
              placeholder={`Search in ${containerId === 'all' ? 'all containers' : 'this container'}...`}
              value={filter.search}
              onChange={handleSearchChange}
            />
          </div>
        </div>
        
        <div className="col-md-3 text-end">
          <small className="text-muted">
            Container: <span className="text-primary">{containerId}</span>
          </small>
        </div>
      </div>
    </div>
  );
};

export default LogFilterBar;

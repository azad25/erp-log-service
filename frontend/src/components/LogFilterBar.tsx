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
    <div className="log-filter-bar bg-secondary border-bottom border-dark p-2 flex-shrink-0">
      <div className="row align-items-center g-2">
        <div className="col-md-2">
          <select 
            className="form-select form-select-sm bg-dark text-light border-secondary"
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
        
        <div className="col-md-7">
          <div className="input-group input-group-sm">
            <span className="input-group-text bg-dark text-light border-secondary">
              <i className="bi bi-search"></i>
            </span>
            <input
              type="text"
              className="form-control bg-dark border-secondary text-light"
              placeholder={`Search in ${containerId === 'all' ? 'all containers' : containerId.replace('erp-suite-', '')}...`}
              value={filter.search}
              onChange={handleSearchChange}
            />
            {filter.search && (
              <button
                className="btn btn-outline-secondary btn-sm"
                type="button"
                onClick={() => onFilterChange({ search: '' })}
                title="Clear search"
              >
                <i className="bi bi-x"></i>
              </button>
            )}
          </div>
        </div>
        
        <div className="col-md-3 text-end">
          <small className="text-muted">
            <i className="bi bi-box me-1"></i>
            {containerId === 'all' ? 'All Containers' : containerId.replace('erp-suite-', '')}
          </small>
        </div>
      </div>
    </div>
  );
};

export default LogFilterBar;

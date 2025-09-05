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
    <div className="log-filter-bar bg-dark border-bottom border-secondary p-2 flex-shrink-0">
      <div className="container-fluid">
        <div className="row align-items-center g-2">
          <div className="col-md-2">
            <div className="input-group input-group-sm">
              <span className="input-group-text bg-dark text-light border-secondary">
                <i className="bi bi-filter"></i>
              </span>
              <select 
                className="form-select bg-dark text-light border-secondary"
                value={filter.level}
                onChange={handleLevelChange}
                aria-label="Filter by log level"
              >
                {LOG_LEVELS.map((level) => (
                  <option key={level.value} value={level.value}>
                    {level.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          
          <div className="col-md-8">
            <div className="input-group input-group-sm">
              <span className="input-group-text bg-dark text-light border-secondary">
                <i className="bi bi-search"></i>
              </span>
              <input
                type="text"
                className="form-control bg-dark text-light border-secondary"
                placeholder={`Search in ${containerId === 'all' ? 'all containers' : containerId.replace('erp-suite-', '')}...`}
                value={filter.search}
                onChange={handleSearchChange}
                aria-label="Search logs"
              />
              {filter.search && (
                <button
                  className="btn btn-outline-secondary"
                  type="button"
                  onClick={() => onFilterChange({ search: '' })}
                  title="Clear search"
                >
                  <i className="bi bi-x"></i>
                </button>
              )}
            </div>
          </div>
          
          <div className="col-md-2">
            <div className="d-flex align-items-center justify-content-end h-100">
              <span className="badge bg-secondary text-nowrap">
                <i className="bi bi-box me-1"></i>
                {containerId === 'all' ? 'All Containers' : containerId.replace('erp-suite-', '')}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LogFilterBar;

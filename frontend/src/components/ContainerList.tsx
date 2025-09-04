import React from 'react';
import { ContainerInfo } from '../types/logs';

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
  const runningContainers = containers.filter(c => c.status.toLowerCase().includes('up'));
  const stoppedContainers = containers.filter(c => !c.status.toLowerCase().includes('up'));
  
  const getStatusBadge = (status: string) => {
    if (status.toLowerCase().includes('up')) {
      return { class: 'bg-success', icon: 'bi-check-circle', text: 'Running' };
    } else if (status.toLowerCase().includes('exited')) {
      return { class: 'bg-danger', icon: 'bi-x-circle', text: 'Stopped' };
    } else if (status.toLowerCase().includes('created')) {
      return { class: 'bg-warning', icon: 'bi-pause-circle', text: 'Created' };
    } else {
      return { class: 'bg-secondary', icon: 'bi-question-circle', text: 'Unknown' };
    }
  };

  return (
    <div className="container-list">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h5 className="mb-0 text-primary">
          <i className="bi bi-layers me-2"></i>
          Containers
        </h5>
        <button
          className="btn btn-outline-primary btn-sm"
          onClick={onRefresh}
          title="Refresh containers"
        >
          <i className="bi bi-arrow-clockwise"></i>
        </button>
      </div>

      <div className="mb-3">
        <small className="text-muted">
          <i className="bi bi-circle-fill text-success me-1"></i>
          {runningContainers.length} Running
          <i className="bi bi-circle-fill text-danger ms-3 me-1"></i>
          {stoppedContainers.length} Stopped
        </small>
      </div>

      <div className="list-group">
        {/* All Containers Option */}
        <button
          className={`list-group-item list-group-item-action ${
            selectedContainer === 'all' ? 'active' : ''
          }`}
          onClick={() => onSelectContainer('all')}
        >
          <div className="d-flex w-100 justify-content-between">
            <h6 className="mb-1">
              <i className="bi bi-collection me-2"></i>
              All Containers
            </h6>
          </div>
          <small>View logs from all containers</small>
        </button>

        {/* Application Services */}
        <div className="list-group-item bg-light border-0 mt-2">
          <small className="text-muted fw-bold">
            <i className="bi bi-app me-2"></i>
            Application Services
          </small>
        </div>

        {containers
          .filter(c => !c.isInfra)
          .map((container) => {
            const statusBadge = getStatusBadge(container.status);
            const isRunning = container.status.toLowerCase().includes('up');
            return (
              <button
                key={container.id}
                className={`list-group-item list-group-item-action ${
                  selectedContainer === container.id ? 'active' : ''
                } ${!isRunning ? 'disabled' : ''}`}
                onClick={() => isRunning && onSelectContainer(container.id)}
                disabled={!isRunning}
              >
                <div className="d-flex w-100 justify-content-between align-items-center">
                  <div className="flex-grow-1">
                    <h6 className="mb-1 d-flex align-items-center">
                      <i className={`bi ${isRunning ? 'bi-play-circle text-success' : 'bi-stop-circle text-danger'} me-2`}></i>
                      <span className="text-truncate">{container.name.replace('erp-suite-', '')}</span>
                    </h6>
                    <p className="mb-0 text-muted small text-truncate">{container.image}</p>
                  </div>
                  <div className="text-end">
                    <small className={`badge ${statusBadge.class}`}>
                      <i className={`bi ${statusBadge.icon} me-1`}></i>
                      {statusBadge.text}
                    </small>
                  </div>
                </div>
              </button>
            );
          })}

        {/* Infrastructure Services */}
        <div className="list-group-item bg-light border-0 mt-2">
          <small className="text-muted fw-bold">
            <i className="bi bi-hdd-stack me-2"></i>
            Infrastructure
          </small>
        </div>

        {containers
          .filter(c => c.isInfra)
          .map((container) => {
            const statusBadge = getStatusBadge(container.status);
            const isRunning = container.status.toLowerCase().includes('up');
            return (
              <button
                key={container.id}
                className={`list-group-item list-group-item-action ${
                  selectedContainer === container.id ? 'active' : ''
                } ${!isRunning ? 'disabled' : ''}`}
                onClick={() => isRunning && onSelectContainer(container.id)}
                disabled={!isRunning}
              >
                <div className="d-flex w-100 justify-content-between align-items-center">
                  <div className="flex-grow-1">
                    <h6 className="mb-1 d-flex align-items-center">
                      <i className={`bi ${isRunning ? 'bi-database text-info' : 'bi-stop-circle text-danger'} me-2`}></i>
                      <span className="text-truncate">{container.name.replace('erp-suite-', '')}</span>
                    </h6>
                    <p className="mb-0 text-muted small text-truncate">{container.image}</p>
                  </div>
                  <div className="text-end">
                    <small className={`badge ${statusBadge.class}`}>
                      <i className={`bi ${statusBadge.icon} me-1`}></i>
                      {statusBadge.text}
                    </small>
                  </div>
                </div>
              </button>
            );
          })}

      </div>
    </div>
  );
};

export default ContainerList;

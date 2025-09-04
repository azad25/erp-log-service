import React, { useState } from 'react';
import { ContainerInfo } from '../types/logs';
import ContainerDetails from './ContainerDetails';

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
  const [selectedContainerDetails, setSelectedContainerDetails] = useState<ContainerInfo | null>(null);
  const [showDetails, setShowDetails] = useState(false);
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

  const handleContainerClick = (container: ContainerInfo, event: React.MouseEvent) => {
    // If clicking on the info button, show details modal
    if ((event.target as HTMLElement).closest('.info-btn')) {
      setSelectedContainerDetails(container);
      setShowDetails(true);
      return;
    }
    
    // Otherwise, select container for log viewing
    const isRunning = container.status.toLowerCase().includes('up');
    if (isRunning) {
      onSelectContainer(container.id);
    }
  };

  const handleContainerAction = (action: string, containerId: string) => {
    // Refresh containers after action
    setTimeout(() => {
      onRefresh();
    }, 1000);
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
              <div
                key={container.id}
                className={`list-group-item list-group-item-action position-relative ${
                  selectedContainer === container.id ? 'active' : ''
                } ${!isRunning ? 'disabled' : ''}`}
                onClick={(e) => handleContainerClick(container, e)}
                style={{ cursor: 'pointer' }}
              >
                <div className="d-flex w-100 justify-content-between align-items-center">
                  <div className="flex-grow-1">
                    <h6 className="mb-1 d-flex align-items-center">
                      <i className={`bi ${isRunning ? 'bi-play-circle text-success' : 'bi-stop-circle text-danger'} me-2`}></i>
                      <span className="text-truncate">{container.name.replace('erp-suite-', '')}</span>
                    </h6>
                    <p className="mb-0 text-muted small text-truncate">{container.image}</p>
                  </div>
                  <div className="text-end d-flex align-items-center gap-2">
                    <button
                      className="btn btn-outline-info btn-sm info-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedContainerDetails(container);
                        setShowDetails(true);
                      }}
                      title="Container Details"
                    >
                      <i className="bi bi-info-circle"></i>
                    </button>
                    <small className={`badge ${statusBadge.class}`}>
                      <i className={`bi ${statusBadge.icon} me-1`}></i>
                      {statusBadge.text}
                    </small>
                  </div>
                </div>
              </div>
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
              <div
                key={container.id}
                className={`list-group-item list-group-item-action position-relative ${
                  selectedContainer === container.id ? 'active' : ''
                } ${!isRunning ? 'disabled' : ''}`}
                onClick={(e) => handleContainerClick(container, e)}
                style={{ cursor: 'pointer' }}
              >
                <div className="d-flex w-100 justify-content-between align-items-center">
                  <div className="flex-grow-1">
                    <h6 className="mb-1 d-flex align-items-center">
                      <i className={`bi ${isRunning ? 'bi-database text-info' : 'bi-stop-circle text-danger'} me-2`}></i>
                      <span className="text-truncate">{container.name.replace('erp-suite-', '')}</span>
                    </h6>
                    <p className="mb-0 text-muted small text-truncate">{container.image}</p>
                  </div>
                  <div className="text-end d-flex align-items-center gap-2">
                    <button
                      className="btn btn-outline-info btn-sm info-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedContainerDetails(container);
                        setShowDetails(true);
                      }}
                      title="Container Details"
                    >
                      <i className="bi bi-info-circle"></i>
                    </button>
                    <small className={`badge ${statusBadge.class}`}>
                      <i className={`bi ${statusBadge.icon} me-1`}></i>
                      {statusBadge.text}
                    </small>
                  </div>
                </div>
              </div>
            );
          })}

      </div>

      {/* Container Details Modal */}
      <ContainerDetails
        container={selectedContainerDetails}
        show={showDetails}
        onHide={() => {
          setShowDetails(false);
          setSelectedContainerDetails(null);
        }}
        onContainerAction={handleContainerAction}
      />
    </div>
  );
};

export default ContainerList;

import React from 'react';

interface ConnectionStatusProps {
  isConnected: boolean;
}

const ConnectionStatus: React.FC<ConnectionStatusProps> = ({ isConnected }) => {
  return (
    <div className="d-inline-flex align-items-center">
      <span 
        className={`badge ${isConnected ? 'bg-success' : 'bg-danger'} me-2`}
        style={{ fontSize: '0.6rem' }}
      >
        <i className={`bi ${isConnected ? 'bi-wifi' : 'bi-wifi-off'} me-1`}></i>
        {isConnected ? 'Connected' : 'Disconnected'}
      </span>
    </div>
  );
};

export default ConnectionStatus;

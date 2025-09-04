import React from 'react';

interface ConnectionStatusProps {
  isConnected: boolean;
}

const ConnectionStatus: React.FC<ConnectionStatusProps> = ({ isConnected }) => {
  return (
    <div className="d-inline-flex align-items-center">
      <span 
        className={`badge ${isConnected ? 'bg-success' : 'bg-danger'} me-2 fade-in`}
        style={{ 
          fontSize: '0.7rem',
          transition: 'all 0.3s ease',
          animation: isConnected ? 'none' : 'pulse 2s infinite'
        }}
      >
        <i 
          className={`bi ${isConnected ? 'bi-wifi' : 'bi-wifi-off'} me-1`}
          style={{
            animation: isConnected ? 'none' : 'pulse 1.5s infinite'
          }}
        ></i>
        {isConnected ? 'Live' : 'Disconnected'}
      </span>
      {isConnected && (
        <div 
          className="status-indicator status-running me-2"
          style={{ animation: 'pulse 2s infinite' }}
        ></div>
      )}
    </div>
  );
};

export default ConnectionStatus;

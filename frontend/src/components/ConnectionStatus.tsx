import React, { useEffect, useState } from 'react';

interface ConnectionStatusProps {
  isConnected: boolean;
  lastMessageTime?: number;
  connectionError?: string;
}

const ConnectionStatus: React.FC<ConnectionStatusProps> = ({ 
  isConnected, 
  lastMessageTime,
  connectionError 
}) => {
  const [timeSinceLastMessage, setTimeSinceLastMessage] = useState<number>(0);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    
    if (isConnected && lastMessageTime) {
      const updateTimeSinceLastMessage = () => {
        setTimeSinceLastMessage(Math.floor((Date.now() - lastMessageTime) / 1000));
      };
      
      updateTimeSinceLastMessage();
      interval = setInterval(updateTimeSinceLastMessage, 1000);
    }
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isConnected, lastMessageTime]);

  const getTooltipText = () => {
    if (!isConnected) {
      return connectionError || 'Disconnected from log server';
    }
    
    if (timeSinceLastMessage > 30) {
      return `No updates received for ${timeSinceLastMessage} seconds`;
    }
    
    return 'Connected to log server';
  };

  return (
    <div 
      className="d-inline-flex align-items-center"
      data-bs-toggle="tooltip" 
      data-bs-placement="bottom"
      title={getTooltipText()}
    >
      <span 
        className={`badge ${isConnected ? 'bg-success' : 'bg-danger'} me-2 fade-in`}
        style={{ 
          fontSize: '0.7rem',
          transition: 'all 0.3s ease',
          animation: isConnected ? 'none' : 'pulse 2s infinite',
          opacity: isConnected && timeSinceLastMessage > 30 ? 0.7 : 1
        }}
      >
        <i 
          className={`bi ${isConnected ? 'bi-wifi' : 'bi-wifi-off'} me-1`}
          style={{
            animation: isConnected && timeSinceLastMessage > 30 ? 'pulse 1.5s infinite' : 'none'
          }}
        ></i>
        {isConnected ? (
          timeSinceLastMessage > 30 ? 'Connection Stale' : 'Live'
        ) : (
          'Disconnected'
        )}
      </span>
      {isConnected && timeSinceLastMessage <= 30 && (
        <div 
          className="status-indicator status-running me-2"
          style={{ animation: 'pulse 2s infinite' }}
        ></div>
      )}
    </div>
  );
};

export default ConnectionStatus;

import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { ContainerStatsProvider } from './contexts/ContainerStatsContext';
import { WebSocketProvider } from './contexts/WebSocketContext';
import { LogEntry } from './types/logs';

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

root.render(
  <React.StrictMode>
    <ContainerStatsProvider>
      <WebSocketProvider onMessage={(log: LogEntry, containerId: string) => {
        // Find all components listening for this containerId and update them
        const event = new CustomEvent('logMessage', { 
          detail: { log, containerId } 
        });
        window.dispatchEvent(event);
      }}>
        <App />
      </WebSocketProvider>
    </ContainerStatsProvider>
  </React.StrictMode>
);

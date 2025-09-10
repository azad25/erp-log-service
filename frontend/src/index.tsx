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
    <App />
  </React.StrictMode>
);

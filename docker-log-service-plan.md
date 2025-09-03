create a simple python script with a react js with bootsrap framework,css3 animation design theme, use websocket for real time log updates, use a queue to process new logs to make it efficient
make the view compononent based to better manage it
i want to create a nice ui for viewing docker logs
for this current erp suit docker containers

there are currently 17 containers 
services, tools,dbs,msgs,queues,cache,proxy

so i want to create just a single page, for view formatted docker logs in a nice list format with highlighted time, analyse logs to the the format of logs and then convert in to a nice view ui format

every time new log refreshes and comes, this page should auto update the list with animated slide in, slide out format

first 10 logs must show

there are errors, msgs different kind of logs

so the python processor must format each logs, extract and convert to view object, and show the data

use @erp-log-service for this application
remove existing go files and make this log service with the frontend inside @erp-log-service folder
it must open the page in localhost:8098 

plan your tasks and then make this servicecreate a simple python script with a react js with bootsrap framework,css3 animation design theme
make the view compononent based to better manage it
i want to create a nice ui for viewing docker logs
for this current erp suit docker containers

there are currently 17 containers 
services, tools,dbs,msgs,queues,cache,proxy

so i want to create just a single page, for view formatted docker logs in a nice list format with highlighted time, analyse logs to the the format of logs and then convert in to a nice view ui format

every time new log refreshes and comes, this page should auto update the list with animated slide in, slide out format

first 10 logs must show

there are errors, msgs different kind of logs

so the python processor must format each logs, extract and convert to view object, and show the data

use @erp-log-service for this application
remove existing go files and make this log service with the frontend inside @erp-log-service folder
it must open the page in localhost:8098 

plan your tasks and then make this service

use these codes exactly, write codes based on it and make the service
#!/usr/bin/env python3
"""
Docker Log Viewer Service
A Flask-based service to view and format Docker logs in real-time
"""

import os
import json
import re
import subprocess
import threading
import time
from datetime import datetime
from flask import Flask, render_template, jsonify
from flask_socketio import SocketIO, emit
from flask_cors import CORS

app = Flask(__name__, static_folder='frontend/build/static', template_folder='frontend/build')
app.config['SECRET_KEY'] = 'docker-log-viewer-secret'
socketio = SocketIO(app, cors_allowed_origins="*")
CORS(app)

# Docker containers for ERP system
DOCKER_CONTAINERS = [
    'erp-api-service',
    'erp-web-service', 
    'erp-auth-service',
    'erp-user-service',
    'erp-inventory-service',
    'erp-order-service',
    'erp-payment-service',
    'erp-notification-service',
    'erp-postgres-db',
    'erp-mongodb',
    'erp-redis-cache',
    'erp-rabbitmq',
    'erp-kafka',
    'erp-nginx-proxy',
    'erp-elasticsearch',
    'erp-kibana',
    'erp-prometheus'
]

class LogProcessor:
    """Process and format Docker logs"""
    
    def __init__(self):
        self.log_patterns = {
            'timestamp': r'(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z?)',
            'level': r'\b(DEBUG|INFO|WARN|ERROR|FATAL|TRACE)\b',
            'ip': r'\b(?:\d{1,3}\.){3}\d{1,3}\b',
            'status_code': r'\b[1-5]\d{2}\b',
            'json': r'\{.*\}',
            'url': r'https?://[^\s]+',
            'sql': r'\b(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP)\b.*?(?=\s|$)',
        }
    
    def parse_log_entry(self, log_line, container_name):
        """Parse a single log entry"""
        try:
            # Extract timestamp
            timestamp_match = re.search(self.log_patterns['timestamp'], log_line)
            timestamp = timestamp_match.group(1) if timestamp_match else datetime.now().isoformat()
            
            # Extract log level
            level_match = re.search(self.log_patterns['level'], log_line)
            level = level_match.group(1) if level_match else 'INFO'
            
            # Extract IP addresses
            ip_matches = re.findall(self.log_patterns['ip'], log_line)
            
            # Extract status codes
            status_matches = re.findall(self.log_patterns['status_code'], log_line)
            
            # Check for JSON content
            json_match = re.search(self.log_patterns['json'], log_line)
            json_content = None
            if json_match:
                try:
                    json_content = json.loads(json_match.group(0))
                except:
                    pass
            
            # Determine log type based on container and content
            log_type = self.determine_log_type(container_name, log_line, level)
            
            return {
                'id': f"{container_name}_{int(time.time() * 1000)}",
                'timestamp': timestamp,
                'container': container_name,
                'level': level,
                'message': log_line.strip(),
                'type': log_type,
                'metadata': {
                    'ips': ip_matches,
                    'status_codes': status_matches,
                    'json_data': json_content
                },
                'formatted_time': self.format_timestamp(timestamp)
            }
        except Exception as e:
            return {
                'id': f"error_{int(time.time() * 1000)}",
                'timestamp': datetime.now().isoformat(),
                'container': container_name,
                'level': 'ERROR',
                'message': f"Log parsing error: {str(e)}",
                'type': 'system',
                'metadata': {},
                'formatted_time': datetime.now().strftime('%H:%M:%S')
            }
    
    def determine_log_type(self, container_name, log_line, level):
        """Determine log type based on container and content"""
        log_line_lower = log_line.lower()
        
        if 'db' in container_name or 'postgres' in container_name or 'mongodb' in container_name:
            return 'database'
        elif 'redis' in container_name or 'cache' in container_name:
            return 'cache'
        elif 'rabbitmq' in container_name or 'kafka' in container_name:
            return 'queue'
        elif 'nginx' in container_name or 'proxy' in container_name:
            return 'proxy'
        elif level == 'ERROR' or level == 'FATAL':
            return 'error'
        elif 'api' in log_line_lower or 'request' in log_line_lower:
            return 'api'
        elif 'auth' in log_line_lower or 'login' in log_line_lower:
            return 'auth'
        else:
            return 'application'
    
    def format_timestamp(self, timestamp_str):
        """Format timestamp for display"""
        try:
            if 'T' in timestamp_str:
                dt = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
            else:
                dt = datetime.fromisoformat(timestamp_str)
            return dt.strftime('%H:%M:%S.%f')[:-3]  # Show milliseconds
        except:
            return datetime.now().strftime('%H:%M:%S')

class DockerLogReader:
    """Read Docker logs from containers"""
    
    def __init__(self):
        self.processor = LogProcessor()
        self.running = False
        self.logs_buffer = []
        self.max_logs = 100
    
    def get_container_logs(self, container_name, lines=10):
        """Get recent logs from a specific container"""
        try:
            cmd = f"docker logs --tail {lines} --timestamps {container_name}"
            result = subprocess.run(cmd.split(), capture_output=True, text=True)
            
            if result.returncode == 0:
                logs = result.stdout.strip().split('\n')
                return [self.processor.parse_log_entry(log, container_name) for log in logs if log.strip()]
            else:
                return [{
                    'id': f"error_{container_name}_{int(time.time())}",
                    'timestamp': datetime.now().isoformat(),
                    'container': container_name,
                    'level': 'ERROR',
                    'message': f"Failed to get logs: {result.stderr}",
                    'type': 'system',
                    'metadata': {},
                    'formatted_time': datetime.now().strftime('%H:%M:%S')
                }]
        except Exception as e:
            return [{
                'id': f"exception_{container_name}_{int(time.time())}",
                'timestamp': datetime.now().isoformat(),
                'container': container_name,
                'level': 'ERROR',
                'message': f"Exception getting logs: {str(e)}",
                'type': 'system',
                'metadata': {},
                'formatted_time': datetime.now().strftime('%H:%M:%S')
            }]
    
    def get_all_logs(self, lines_per_container=2):
        """Get logs from all containers"""
        all_logs = []
        for container in DOCKER_CONTAINERS:
            logs = self.get_container_logs(container, lines_per_container)
            all_logs.extend(logs)
        
        # Sort by timestamp
        all_logs.sort(key=lambda x: x['timestamp'], reverse=True)
        return all_logs[:10]  # Return latest 10 logs
    
    def start_log_streaming(self):
        """Start streaming logs in background"""
        self.running = True
        thread = threading.Thread(target=self._stream_logs)
        thread.daemon = True
        thread.start()
    
    def _stream_logs(self):
        """Background thread to stream logs"""
        while self.running:
            try:
                new_logs = self.get_all_logs(1)
                if new_logs:
                    socketio.emit('new_logs', new_logs)
                time.sleep(2)  # Check for new logs every 2 seconds
            except Exception as e:
                print(f"Error streaming logs: {e}")
                time.sleep(5)

# Initialize log reader
log_reader = DockerLogReader()

@app.route('/')
def index():
    """Serve the React frontend"""
    return render_template('index.html')

@app.route('/api/logs')
def get_logs():
    """API endpoint to get current logs"""
    logs = log_reader.get_all_logs()
    return jsonify(logs)

@app.route('/api/containers')
def get_containers():
    """API endpoint to get container list"""
    return jsonify(DOCKER_CONTAINERS)

@socketio.on('connect')
def handle_connect():
    """Handle WebSocket connection"""
    print('Client connected')
    # Send initial logs
    logs = log_reader.get_all_logs()
    emit('initial_logs', logs)

@socketio.on('disconnect')
def handle_disconnect():
    """Handle WebSocket disconnection"""
    print('Client disconnected')

@socketio.on('request_logs')
def handle_log_request(data):
    """Handle log request from client"""
    container = data.get('container', None)
    if container and container in DOCKER_CONTAINERS:
        logs = log_reader.get_container_logs(container, 10)
        emit('container_logs', logs)

if __name__ == '__main__':
    print("Starting ERP Docker Log Viewer Service...")
    print("Access at: http://localhost:8098")
    print("Real-time streaming via WebSocket")
    
    # Start log streaming automatically
    log_streamer.start_all_streams()
    
    # Run the app
    socketio.run(app, host='0.0.0.0', port=8098, debug=True)

    import React, { useState, useEffect, useCallback } from 'react';
import io from 'socket.io-client';
import 'bootstrap/dist/css/bootstrap.min.css';
import './App.css';
import LogViewer from './components/LogViewer';
import ContainerList from './components/ContainerList';
import ConnectionStatus from './components/ConnectionStatus';
import LogStats from './components/LogStats';

const App = () => {
  const [logs, setLogs] = useState([]);
  const [containers, setContainers] = useState([]);
  const [selectedContainer, setSelectedContainer] = useState('all');
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [socket, setSocket] = useState(null);
  const [streamingStatus, setStreamingStatus] = useState('stopped');
  const [logStats, setLogStats] = useState({});

  // Initialize WebSocket connection
  useEffect(() => {
    const newSocket = io('http://localhost:8098', {
      transports: ['websocket'],
      upgrade: false
    });

    newSocket.on('connect', () => {
      console.log('Connected to WebSocket server');
      setConnectionStatus('connected');
      setSocket(newSocket);
    });

    newSocket.on('disconnect', () => {
      console.log('Disconnected from WebSocket server');
      setConnectionStatus('disconnected');
    });

    newSocket.on('initial_data', (data) => {
      console.log('Received initial data:', data);
      setLogs(data.logs || []);
      setContainers(data.containers || []);
      updateLogStats(data.logs || []);
    });

    newSocket.on('new_log', (logEntry) => {
      console.log('New log entry:', logEntry);
      setLogs(prevLogs => {
        const newLogs = [logEntry, ...prevLogs].slice(0, 100); // Keep only latest 100 logs
        updateLogStats(newLogs);
        return newLogs;
      });
    });

    newSocket.on('container_logs', (data) => {
      console.log('Container logs received:', data);
      setLogs(data.logs || []);
      updateLogStats(data.logs || []);
    });

    newSocket.on('streaming_status', (data) => {
      console.log('Streaming status:', data.status);
      setStreamingStatus(data.status);
    });

    // Cleanup on unmount
    return () => {
      newSocket.disconnect();
    };
  }, []);

  // Update log statistics
  const updateLogStats = useCallback((logEntries) => {
    const stats = {
      total: logEntries.length,
      errors: logEntries.filter(log => log.level === 'ERROR' || log.level === 'FATAL').length,
      warnings: logEntries.filter(log => log.level === 'WARN').length,
      info: logEntries.filter(log => log.level === 'INFO').length,
      debug: logEntries.filter(log => log.level === 'DEBUG').length,
      containers: [...new Set(logEntries.map(log => log.container))].length,
      types: logEntries.reduce((acc, log) => {
        acc[log.type] = (acc[log.type] || 0) + 1;
        return acc;
      }, {})
    };
    setLogStats(stats);
  }, []);

  // Handle container selection
  const handleContainerSelect = useCallback((containerName) => {
    setSelectedContainer(containerName);
    
    if (containerName === 'all') {
      // Request all recent logs
      if (socket) {
        socket.emit('start_streaming');
      }
    } else {
      // Request specific container logs
      if (socket) {
        socket.emit('request_container_logs', { container: containerName });
      }
    }
  }, [socket]);

  // Start/Stop streaming
  const toggleStreaming = useCallback(() => {
    if (socket) {
      if (streamingStatus === 'started') {
        socket.emit('stop_streaming');
      } else {
        socket.emit('start_streaming');
      }
    }
  }, [socket, streamingStatus]);

  // Filter logs based on selected container
  const filteredLogs = selectedContainer === 'all' 
    ? logs 
    : logs.filter(log => log.container === selectedContainer);

  return (
    <div className="app">
      {/* Header */}
      <header className="bg-dark text-white py-3 mb-4">
        <div className="container-fluid">
          <div className="row align-items-center">
            <div className="col-md-6">
              <h1 className="h3 mb-0">
                <i className="bi bi-layers me-2"></i>
                ERP Docker Log Viewer
              </h1>
              <small className="text-muted">Real-time container log monitoring</small>
            </div>
            <div className="col-md-6 text-end">
              <ConnectionStatus status={connectionStatus} />
              <button 
                className={`btn btn-sm ms-2 ${streamingStatus === 'started' ? 'btn-danger' : 'btn-success'}`}
                onClick={toggleStreaming}
                disabled={connectionStatus !== 'connected'}
              >
                {streamingStatus === 'started' ? 'Stop Streaming' : 'Start Streaming'}
              </button>
            </div>
          </div>
        </div>
      </header>

      <div className="container-fluid">
        <div className="row">
          {/* Sidebar */}
          <div className="col-lg-3 col-md-4 mb-4">
            <div className="sticky-top" style={{ top: '20px' }}>
              {/* Log Statistics */}
              <LogStats stats={logStats} />
              
              {/* Container List */}
              <ContainerList 
                containers={containers}
                selectedContainer={selectedContainer}
                onContainerSelect={handleContainerSelect}
              />
            </div>
          </div>

          {/* Main Content */}
          <div className="col-lg-9 col-md-8">
            <LogViewer 
              logs={filteredLogs}
              selectedContainer={selectedContainer}
              connectionStatus={connectionStatus}
              streamingStatus={streamingStatus}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;

import React, { useState, useEffect, useRef } from 'react';
import LogEntry from './LogEntry';

const LogViewer = ({ logs, selectedContainer, connectionStatus, streamingStatus }) => {
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const logContainerRef = useRef(null);
  const prevLogsLengthRef = useRef(logs.length);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && logContainerRef.current && logs.length > prevLogsLengthRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
    prevLogsLengthRef.current = logs.length;
  }, [logs, autoScroll]);

  // Filter logs based on level and search term
  const filteredLogs = logs.filter(log => {
    const matchesFilter = filter === 'all' || log.level.toLowerCase() === filter.toLowerCase();
    const matchesSearch = searchTerm === '' || 
      log.message.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.container.toLowerCase().includes(searchTerm.toLowerCase());
    
    return matchesFilter && matchesSearch;
  });

  const handleScroll = (e) => {
    const { scrollTop, scrollHeight, clientHeight } = e.target;
    const isAtBottom = scrollHeight - scrollTop === clientHeight;
    setAutoScroll(isAtBottom);
  };

  const clearLogs = () => {
    // This would need to be implemented in the parent component
    // For now, just scroll to top
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = 0;
    }
  };

  const scrollToBottom = () => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
      setAutoScroll(true);
    }
  };

  const getLogLevelCounts = () => {
    const counts = {
      ERROR: 0,
      WARN: 0,
      INFO: 0,
      DEBUG: 0,
      TRACE: 0
    };
    
    filteredLogs.forEach(log => {
      if (counts.hasOwnProperty(log.level)) {
        counts[log.level]++;
      }
    });
    
    return counts;
  };

  const logCounts = getLogLevelCounts();

  return (
    <div className="log-viewer">
      {/* Controls */}
      <div className="card mb-3">
        <div className="card-header">
          <div className="row align-items-center">
            <div className="col-md-6">
              <h5 className="card-title mb-0">
                Logs {selectedContainer !== 'all' && `- ${selectedContainer}`}
                <span className="badge bg-secondary ms-2">{filteredLogs.length}</span>
              </h5>
            </div>
            <div className="col-md-6">
              <div className="d-flex gap-2 justify-content-end">
                <button 
                  className="btn btn-sm btn-outline-secondary"
                  onClick={scrollToBottom}
                  title="Scroll to bottom"
                >
                  <i className="bi bi-arrow-down"></i>
                </button>
                <button 
                  className="btn btn-sm btn-outline-secondary"
                  onClick={clearLogs}
                  title="Clear view"
                >
                  <i className="bi bi-trash"></i>
                </button>
                <div className="form-check form-switch">
                  <input 
                    className="form-check-input" 
                    type="checkbox" 
                    id="autoScroll"
                    checked={autoScroll}
                    onChange={(e) => setAutoScroll(e.target.checked)}
                  />
                  <label className="form-check-label" htmlFor="autoScroll">
                    Auto-scroll
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        <div className="card-body py-2">
          <div className="row align-items-center">
            <div className="col-md-4">
              <div className="input-group input-group-sm">
                <span className="input-group-text">
                  <i className="bi bi-search"></i>
                </span>
                <input
                  type="text"
                  className="form-control"
                  placeholder="Search logs..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>
            
            <div className="col-md-4">
              <select 
                className="form-select form-select-sm"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              >
                <option value="all">All Levels</option>
                <option value="error">Errors ({logCounts.ERROR})</option>
                <option value="warn">Warnings ({logCounts.WARN})</option>
                <option value="info">Info ({logCounts.INFO})</option>
                <option value="debug">Debug ({logCounts.DEBUG})</option>
                <option value="trace">Trace ({logCounts.TRACE})</option>
              </select>
            </div>
            
            <div className="col-md-4">
              <div className="d-flex gap-1 justify-content-end">
                <span className="badge bg-danger">E: {logCounts.ERROR}</span>
                <span className="badge bg-warning text-dark">W: {logCounts.WARN}</span>
                <span className="badge bg-info">I: {logCounts.INFO}</span>
                <span className="badge bg-secondary">D: {logCounts.DEBUG}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Connection Status */}
      {connectionStatus !== 'connected' && (
        <div className="alert alert-warning" role="alert">
          <i className="bi bi-exclamation-triangle me-2"></i>
          WebSocket connection status: {connectionStatus}. Logs may not update in real-time.
        </div>
      )}

      {/* Log Entries */}
      <div className="card">
        <div 
          className="card-body p-0 log-container"
          ref={logContainerRef}
          onScroll={handleScroll}
          style={{
            height: '70vh',
            overflowY: 'auto',
            backgroundColor: '#1a1a1a',
            fontFamily: 'Monaco, "Lucida Console", monospace'
          }}
        >
          {filteredLogs.length === 0 ? (
            <div className="p-4 text-center text-muted">
              {logs.length === 0 ? (
                <>
                  <i className="bi bi-hourglass-split fs-1 d-block mb-3"></i>
                  <h5>Waiting for logs...</h5>
                  <p>Stream status: {streamingStatus}</p>
                </>
              ) : (
                <>
                  <i className="bi bi-funnel fs-1 d-block mb-3"></i>
                  <h5>No logs match your filter</h5>
                  <p>Try adjusting your search term or log level filter.</p>
                </>
              )}
            </div>
          ) : (
            <div className="log-entries">
              {filteredLogs.map((log, index) => (
                <LogEntry 
                  key={`${log.id}-${index}`}
                  log={log}
                  isNew={index < 5} // Mark first 5 as new for animation
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Status Bar */}
      <div className="mt-3 text-muted small">
        <div className="row">
          <div className="col-md-6">
            Showing {filteredLogs.length} of {logs.length} logs
            {selectedContainer !== 'all' && ` from ${selectedContainer}`}
          </div>
          <div className="col-md-6 text-end">
            Stream: {streamingStatus} | Connection: {connectionStatus}
          </div>
        </div>
      </div>
    </div>
  );
};

export default LogViewer;


read these codes and plans
and make the docker log service
inside ./erp-suite/erp-log-service
use python fast api
Set up the project structure
Create a Python FastAPI backend to fetch and process Docker logs
Build a React frontend with Bootstrap and animations
Implement WebSocket for real-time updates
Create log parsing and formatting logic
Style the UI with CSS animations

use 8092 port for this service
and make sure 
the page displays all the application services first
the page will display all the container logs within the viewport height
then the infra services
make sure to add a way to see previous logs of each container
add tooltip when hovered over container to show container info
make sure to add a green fot circle for running containers and red circle dot for stopped/not running
orange dot icon for when starting
add start,stop,restart respective buttons for each container
use just icons for buttons, no title needed
also add a icon to view all the rag lows in a modal, when clicked, a modal will full screen open and show all the logs of the selected container, and button for closing the modal


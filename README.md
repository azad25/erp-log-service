# ERP Log Service

Real-time Docker container log monitoring service for the ERP Suite.

## Features

- Real-time log streaming from Docker containers
- Container status monitoring (Running, Stopped, Created, Unknown)
- WebSocket-based log streaming
- Filter and search logs
- Responsive web interface
- Categorized container view (Application Services, Infrastructure)

## Architecture

- **Frontend**: React/TypeScript web interface (port 3004)
- **Backend**: FastAPI service (port 8093)
- **WebSocket**: Real-time log streaming
- **Docker**: Container management and log collection

## Prerequisites

- Docker and Docker Compose
- Node.js 16+ (for development)
- Python 3.9+ (for backend development)

## Quick Start

### Using Docker Compose

```bash
# Start the ERP Log Service with all dependencies
docker compose up -d
```

### Development Setup

#### Backend

```bash
# Navigate to backend directory
cd backend

# Create and activate virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: .\venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Start the backend server
uvicorn app.main:app --reload --port 8093
```

#### Frontend

```bash
# Navigate to frontend directory
cd frontend

# Install dependencies
npm install

# Start the development server
npm start
```

## API Endpoints

### REST API

- `GET /api/v1/health` - Health check
- `GET /api/v1/containers` - List all containers
- `GET /api/v1/containers/{container_id}/logs` - Get historical logs for a container

### WebSocket

- `ws://localhost:3004/api/v1/logs/ws/logs/{container_id}` - Real-time log stream for a container

## Environment Variables

### Backend

```
LOG_LEVEL=info
DOCKER_HOST=unix:///var/run/docker.sock
REDIS_URL=redis://redis:6379/0
API_KEY=your-api-key
```

### Frontend

```
REACT_APP_API_URL=http://localhost:8093
REACT_APP_WS_URL=ws://localhost:8093
```

## Development

### Backend Testing

```bash
cd backend
pytest
```

### Frontend Testing

```bash
cd frontend
npm test
```

## Deployment

### Production Build

```bash
# Build frontend
cd frontend
npm run build

# Build and start containers
docker compose -f docker-compose.prod.yml up -d --build
```

## Troubleshooting

### WebSocket Connection Issues

1. Ensure the backend service is running and accessible
2. Verify the WebSocket URL is correct
3. Check browser console for any errors
4. Verify CORS and proxy settings

### Log Collection Issues

1. Check Docker daemon is running
2. Verify container permissions
3. Check backend logs for errors

## License

Proprietary - ERP Suite

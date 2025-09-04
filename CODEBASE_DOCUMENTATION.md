# ERP Log Service Codebase Documentation

This document provides an overview of the ERP Log Service codebase, its architecture, and guidance for developers to understand and extend the project.

---

## Project Structure

```
erp-log-service/
├── backend/
│   ├── main.py                # FastAPI app entry point
│   ├── requirements.txt       # Python dependencies
│   └── app/
│       ├── api/
│       │   ├── __init__.py
│       │   └── endpoints/
│       │       └── logs.py    # API & WebSocket endpoints for logs/containers
│       ├── core/
│       │   └── config.py      # App configuration (env, port, etc.)
│       ├── models/            # (Reserved for future data models)
│       ├── services/
│       │   ├── log_processor.py # Log parsing/formatting logic
│       │   └── log_streamer.py  # WebSocket log streaming logic
│       ├── utils/             # (Reserved for helpers)
│       └── tests/             # Backend tests
├── frontend/
│   ├── package.json           # React dependencies
│   ├── src/
│   │   ├── components/
│   │   │   ├── ContainerList.tsx # Container list & modal UI
│   │   │   ├── LogViewer.tsx     # Main log viewer UI
│   │   │   ├── LogsModal.tsx     # Modal for viewing logs
│   │   │   └── LogFilterBar.tsx  # Log filtering/search UI
│   │   ├── contexts/
│   │   │   └── WebSocketContext.tsx # WebSocket context provider
│   │   ├── services/
│   │   │   ├── api.ts             # API calls (logs, containers)
│   │   │   └── containerService.ts# Container actions (start/stop/restart)
│   │   ├── types/
│   │   │   ├── containers.ts      # Container type definitions
│   │   │   └── logs.ts            # Log type definitions
│   │   ├── utils/
│   │   │   └── containerIcons.tsx # Icon mapping for containers
│   │   └── App.tsx                # Main React app
│   └── public/                    # Static assets
├── docker-compose.yml             # Dev environment setup
├── Dockerfile.dev                 # Dev Dockerfile
├── README.md                      # Project overview
└── CODEBASE_DOCUMENTATION.md      # (This file)
```

---

## Backend (Python/FastAPI)

- **main.py**: Initializes FastAPI app, sets up CORS, includes API routes, and defines WebSocket endpoints for real-time log streaming.
- **app/core/config.py**: Centralized configuration (port, host, env vars, etc.).
- **app/api/endpoints/logs.py**: REST and WebSocket endpoints for:
  - Listing containers
  - Fetching recent logs
  - Streaming logs via WebSocket
  - Container actions (start/stop/restart)
- **app/services/log_processor.py**: Parses and formats raw Docker logs into structured objects, extracting timestamps, log levels, and metadata.
- **app/services/log_streamer.py**: Manages WebSocket connections, streams logs to clients, maintains log buffers per container.

### How Log Streaming Works
- When a client connects via WebSocket, `log_streamer` starts streaming logs for the requested container.
- Logs are parsed by `LogProcessor` and sent to the frontend in real-time.
- REST endpoints allow fetching recent logs and managing containers.

---

## Frontend (React/TypeScript)

- **App.tsx**: Main entry, sets up layout, WebSocket connection, and routes.
- **components/ContainerList.tsx**: Displays containers, status, tooltips, and modal for viewing logs. Supports start/stop/restart actions.
- **components/LogViewer.tsx**: Shows live logs with filtering, searching, and auto-scroll.
- **components/LogsModal.tsx**: Fullscreen modal for viewing all logs of a container.
- **contexts/WebSocketContext.tsx**: Provides WebSocket connection and state to components.
- **services/api.ts**: Handles API requests for logs and containers.
- **services/containerService.ts**: Handles container actions via API.
- **types/**: Type definitions for containers and logs.
- **utils/containerIcons.tsx**: Maps container names to icons.

### UI Features
- Application and infrastructure containers are visually separated.
- Status dots (green, red, orange) indicate running/stopped/starting containers.
- Tooltips show container info on hover.
- Modal displays previous logs with color-coded backgrounds (green for success/info, red for error/fatal).
- New logs animate in (slide-in), old logs slide out.
- Filtering and searching supported.

---

## Development & Extension

- **Backend**: Add new endpoints in `app/api/endpoints/`, extend log parsing in `log_processor.py`, or add new services in `app/services/`.
- **Frontend**: Add new UI features in `src/components/`, extend types in `src/types/`, or add new API calls in `src/services/`.
- **WebSocket**: Extend real-time features via `log_streamer.py` and `WebSocketContext.tsx`.

---

## Running Locally

1. **Backend**:
   - Install Python dependencies: `pip install -r backend/requirements.txt`
   - Start FastAPI: `uvicorn backend.main:app --reload --port 8092`
2. **Frontend**:
   - Install Node dependencies: `cd frontend && npm install`
   - Start React app: `npm start`
3. **Docker Compose**:
   - Use `docker-compose.yml` for local dev environment.

---

## Useful Tips
- All logs are streamed and buffered per container for efficient real-time updates.
- Use the modal to view previous logs and color-coded log entries.
- Extend log parsing logic in `log_processor.py` for new log formats.
- Use type definitions in `src/types/` for consistent data handling.

---

## Contact & Contribution
- For questions, see `README.md` or contact the maintainers.
- Contributions welcome! Please follow the code structure and add documentation for new features.

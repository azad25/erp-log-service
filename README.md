# log-viewer Service

log-viewer microservice for ERP Suite.

## Quick Start

```bash
# Start infrastructure
cd ../erp-suit-infrastructure
make start-dev

# Start this service
docker compose up -d log-viewer-service
```

## Endpoints

- `GET /health` - Health check
- `GET /api/v1/log-viewer` - List items
- `POST /api/v1/log-viewer` - Create item
- `GET /api/v1/log-viewer/:id` - Get item
- `PUT /api/v1/log-viewer/:id` - Update item
- `DELETE /api/v1/log-viewer/:id` - Delete item

## Development

```bash
go run main.go
```

Service runs on port 8082

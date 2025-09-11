#!/bin/bash
set -e

# Create directories with proper permissions
mkdir -p /app/tmp /app/logs && chmod -R 755 /app/tmp /app/logs

# Start nginx in background
nginx -g "daemon off;" &

# Start FastAPI backend on port 8093
cd /app && python backend/main.py --host 0.0.0.0 --port 8093 &

# Start React frontend development server on port 3004
cd /app/frontend && npm install && PORT=3004 npm start &

# Wait for any process to exit
wait -n

# Exit with status of process that exited first
exit $?

#!/bin/bash
cd "$(dirname "$0")"

# Kill anything already on port 8080
if lsof -ti:8080 &>/dev/null; then
  echo "Stopping existing server on port 8080..."
  kill $(lsof -ti:8080) 2>/dev/null
  sleep 1
fi

echo "Starting ClipKings..."
echo "Open http://localhost:8080 in your browser"
echo "Press Ctrl+C to stop"
venv/bin/python server.py

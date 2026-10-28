#!/usr/bin/env bash
# Quick launcher for SkySpeed
cd "$(dirname "$0")"

PORT=8080
if [ -n "$1" ]; then
    PORT="$1"
fi

echo "Starting SkySpeed on port $PORT..."
python3 app.py --port "$PORT"

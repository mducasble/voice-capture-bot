#!/bin/bash
set -e

ROLE="${ROLE:-api}"
WORKERS="${WORKERS:-4}"
CELERY_CONCURRENCY="${CELERY_CONCURRENCY:-2}"

if [ "$ROLE" = "worker" ]; then
    echo "Starting Celery worker (concurrency=$CELERY_CONCURRENCY)..."
    exec celery -A app.worker worker \
        --loglevel=info \
        --concurrency="$CELERY_CONCURRENCY" \
        --max-tasks-per-child=50 \
        --without-heartbeat
else
    echo "Starting API server (workers=$WORKERS)..."
    exec uvicorn app.main:app \
        --host 0.0.0.0 \
        --port 8000 \
        --workers "$WORKERS" \
        --timeout-keep-alive 300 \
        --limit-max-requests 10000
fi

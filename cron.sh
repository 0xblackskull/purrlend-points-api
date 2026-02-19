#!/bin/bash
# Railway Cron Job - runs every hour
# This script is called by Railway's cron service

curl -X POST \
  -H "x-cron-secret: ${CRON_SECRET}" \
  http://localhost:${PORT}/api/points/snapshot \
  || echo "Snapshot failed at $(date)"

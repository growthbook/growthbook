#!/bin/bash

# Exits processes when idle for a given amount of time by
# monitoring TCP connections

TIMEOUT=${PREVIEW_IDLE_TIMEOUT_SECONDS:-1800}
CHECK_INTERVAL_SECONDS=5
LOG_INTERVAL_SECONDS=60

last_activity=$(date +%s)
last_log=0

echo "[idle-monitor] Started. Timeout: ${TIMEOUT}s, Monitoring ports: 3000, 3100"

while true; do
  # Check for connections in ESTABLISHED or TIME_WAIT state
  # TIME_WAIT persists ~60s after connection close, catching quick requests
  connections=$(ss -tan state established state time-wait 2>/dev/null | grep -E ':3000|:3100' | wc -l)

  now=$(date +%s)

  if [ "$connections" -gt 0 ]; then
    last_activity=$now
  fi

  idle_time=$((now - last_activity))

  # Log every LOG_INTERVAL_SECONDS to avoid spam
  if [ $((now - last_log)) -ge $LOG_INTERVAL_SECONDS ]; then
    echo "[idle-monitor] Connections: $connections, Idle: ${idle_time}s / ${TIMEOUT}s"
    last_log=$now
  fi

  if [ "$idle_time" -ge "$TIMEOUT" ]; then
    echo "[idle-monitor] Idle for ${idle_time}s (>= ${TIMEOUT}s). Shutting down."
    # Stop supervisord which will stop all processes
    kill -SIGTERM $(cat /var/run/supervisord.pid 2>/dev/null) 2>/dev/null || kill -SIGTERM 1
    # Exit 0 means the machine will not restart automatically
    exit 0
  fi

  sleep $CHECK_INTERVAL_SECONDS
done

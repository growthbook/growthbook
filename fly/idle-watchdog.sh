#!/bin/bash
# Idle watchdog for Fly.io PR preview environments
# Monitors TCP connections (including TIME_WAIT) and exits when idle

TIMEOUT=${FLY_IDLE_TIMEOUT_SECONDS:-1800}
CHECK_INTERVAL=5

last_activity=$(date +%s)

echo "[watchdog] Started. Timeout: ${TIMEOUT}s, Monitoring ports: 3000, 3100"

while true; do
  # Check for connections in ESTABLISHED or TIME_WAIT state
  # TIME_WAIT persists ~60s after connection close, catching quick requests
  connections=$(ss -tan state established state time-wait 2>/dev/null | grep -E ':3000|:3100' | wc -l)

  now=$(date +%s)

  if [ "$connections" -gt 0 ]; then
    last_activity=$now
  fi

  idle_time=$((now - last_activity))

  # Log every 60 seconds to avoid spam
  if [ $((now % 60)) -lt $CHECK_INTERVAL ]; then
    echo "[watchdog] Connections: $connections, Idle: ${idle_time}s / ${TIMEOUT}s"
  fi

  if [ "$idle_time" -ge "$TIMEOUT" ]; then
    echo "[watchdog] Idle for ${idle_time}s (>= ${TIMEOUT}s). Shutting down."
    exit 0
  fi

  sleep $CHECK_INTERVAL
done

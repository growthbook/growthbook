// Shell-free port of idle-monitor.sh for the Docker Hardened Image build.
//
// Shuts the container down after a period with no traffic on ports 3000/3100,
// so idle Fly preview machines stop themselves. The distroless runtime has no
// `ss`/`pkill`, so connections are counted by reading /proc/net/tcp{,6}
// directly, and shutdown is triggered by signaling PID 1 (the supervisor),
// which tears down its children and exits gracefully.
//
// Launched as a child of bin/dhi-supervisor.js when PREVIEW_IDLE_TIMEOUT_SECONDS
// is set (mirrors the idle-monitor entry in ecosystem.config.js).

const fs = require("node:fs");

const TIMEOUT = Number(process.env.PREVIEW_IDLE_TIMEOUT_SECONDS) || 1800;
const CHECK_INTERVAL_MS = 5000;
const LOG_INTERVAL_MS = 60000;

const PORTS = new Set([3000, 3100]);
// /proc/net/tcp connection states: ESTABLISHED=0x01, TIME_WAIT=0x06.
// TIME_WAIT persists ~60s after close, so quick requests are still counted.
const ACTIVE_STATES = new Set(["01", "06"]);

const portOf = (hexAddr) => parseInt(hexAddr.split(":")[1], 16);

function countConnections() {
  let count = 0;
  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    let lines;
    try {
      lines = fs.readFileSync(file, "utf8").split("\n");
    } catch {
      continue; // tcp6 may be absent if IPv6 is disabled
    }
    for (const line of lines.slice(1)) {
      const f = line.trim().split(/\s+/);
      if (f.length < 4) continue;
      if (!ACTIVE_STATES.has(f[3])) continue;
      if (PORTS.has(portOf(f[1])) || PORTS.has(portOf(f[2]))) count++;
    }
  }
  return count;
}

let lastActivity = Date.now();
let lastLog = 0;
let triggered = false;

console.log(
  `[idle-monitor] Started. Timeout: ${TIMEOUT}s, Monitoring ports: 3000, 3100`,
);

setInterval(() => {
  if (triggered) return;

  const connections = countConnections();
  const now = Date.now();

  if (connections > 0) lastActivity = now;
  const idleSeconds = Math.floor((now - lastActivity) / 1000);

  if (now - lastLog >= LOG_INTERVAL_MS) {
    console.log(
      `[idle-monitor] Connections: ${connections}, Idle: ${idleSeconds}s / ${TIMEOUT}s`,
    );
    lastLog = now;
  }

  if (idleSeconds >= TIMEOUT) {
    triggered = true;
    console.log(
      `[idle-monitor] Idle for ${idleSeconds}s (>= ${TIMEOUT}s). Shutting down.`,
    );
    // Signal the supervisor (PID 1) to gracefully stop all processes. We stay
    // alive afterwards and let the supervisor terminate us, so the supervisor
    // sees an intentional shutdown rather than an unexpected child exit.
    process.kill(1, "SIGTERM");
  }
}, CHECK_INTERVAL_MS);

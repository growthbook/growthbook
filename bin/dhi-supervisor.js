#!/usr/bin/env node
// Shell-free process supervisor for the Docker Hardened Image build.
//
// Replaces pm2-runtime, which shells out (`/bin/sh -c "getconf CLK_TCK"`) for
// process metrics and therefore cannot run in a distroless runtime that has no
// /bin/sh. This forks the same two processes ecosystem.config.js defines,
// forwards termination signals, and brings the whole container down if either
// child dies — so the orchestrator (k8s/ECS) restarts a clean container.
//
// Deliberately NOT reimplemented from pm2:
//   - in-container autorestart (PM2_AUTORESTART already defaulted to false here)
//   - max_memory_restart
// Both are delegated to the platform supervising the container.
//
// Tracing (Datadog / OpenTelemetry) is honored via `node --require`, mirroring
// ecosystem.config.js. The preview idle-monitor is also launched here (as a
// child) when PREVIEW_IDLE_TIMEOUT_SECONDS is set, mirroring ecosystem.config.js;
// on idle it signals this supervisor (its parent) to bring the container down.

const { spawn } = require("node:child_process");
const path = require("node:path");

const ROOT = path.resolve(__dirname, ".."); // /usr/local/src/app

const tracing = process.env.TRACING_PROVIDER;
const backendNodeArgs = [];
if (tracing === "opentelemetry") {
  backendNodeArgs.push("--require", "./dist/tracing.opentelemetry.js");
} else if (tracing === "datadog") {
  backendNodeArgs.push("--require", "./dist/tracing.datadog.js");
}

// Optional `--only <name>` runs a single app — mirrors pm2's `--only` so this
// one entrypoint works both for local all-in-one runs (`docker run`) and for the
// k8s Helm chart, which runs back-end and front-end as separate single-app pods.
const onlyIdx = process.argv.indexOf("--only");
const only = onlyIdx !== -1 ? process.argv[onlyIdx + 1] : null;

const allApps = [
  {
    name: "back-end",
    cwd: path.join(ROOT, "packages/back-end"),
    args: [...backendNodeArgs, "dist/server.js"],
  },
  {
    name: "front-end",
    cwd: path.join(ROOT, "packages/front-end"),
    args: ["node_modules/next/dist/bin/next", "start"],
  },
  // Preview-only: shuts the container down after a period of inactivity. Gated
  // on the env var (like ecosystem.config.js) so it never runs in production.
  ...(process.env.PREVIEW_IDLE_TIMEOUT_SECONDS
    ? [
        {
          name: "idle-monitor",
          cwd: ROOT,
          args: ["preview/idle-monitor.js"],
        },
      ]
    : []),
];

const apps = allApps.filter((a) => !only || a.name === only);
if (apps.length === 0) {
  console.error(
    `[supervisor] --only "${only}" matched no app (expected one of: ${allApps
      .map((a) => a.name)
      .join(", ")})`,
  );
  process.exit(1);
}

const children = [];
let shuttingDown = false;

const log = (msg) => console.log(`[supervisor] ${msg}`);

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`received ${signal}; forwarding to child process(es)`);
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill(signal);
    }
  }
}

for (const app of apps) {
  log(`starting ${app.name}: node ${app.args.join(" ")} (cwd ${app.cwd})`);
  const child = spawn(process.execPath, app.args, {
    cwd: app.cwd,
    stdio: "inherit",
    env: process.env,
  });
  children.push(child);

  child.on("exit", (code, signal) => {
    log(`${app.name} exited (code=${code}, signal=${signal})`);
    if (!shuttingDown) {
      // Neither process should exit during normal operation — treat any
      // unexpected exit as a container failure (non-zero) and tear down.
      process.exitCode = code || 1;
      shutdown("SIGTERM");
    }
  });

  child.on("error", (err) => {
    log(`${app.name} failed to start: ${err.message}`);
    if (!shuttingDown) {
      process.exitCode = 1;
      shutdown("SIGTERM");
    }
  });
}

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => shutdown(sig));
}

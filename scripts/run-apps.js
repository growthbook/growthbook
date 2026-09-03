#!/usr/bin/env node
// Foreground process supervisor for the container image, in place of pm2-runtime.
// Accepts pm2-runtime's argv shape (`start <config> [--only <app>]`) and the subset
// of ecosystem.config.js fields we actually use: name, script, args, cwd, node_args,
// autorestart, max_memory_restart.

"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const KILL_TIMEOUT_MS =
  Number(process.env.APP_KILL_TIMEOUT_MS || process.env.PM2_KILL_TIMEOUT) ||
  5000;
const RESTART_DELAY_MS = 1000;
const MEMORY_POLL_MS = 10000;
// Node's own baseline RSS is ~46MB, so a limit under this restarts on every poll.
const MIN_MEMORY_BYTES = 50 * 1024 * 1024;
const RESTART_WINDOW_MS = 60000;
const MAX_RESTARTS_PER_WINDOW = 5;

function parseArgs(argv) {
  let only = null;
  let configPath = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "start") continue;
    if (arg === "--only") only = argv[++i];
    else if (arg.startsWith("--only=")) only = arg.slice("--only=".length);
    else if (!arg.startsWith("-") && !configPath) configPath = arg;
  }
  return { only, configPath };
}

const toArray = (value) =>
  Array.isArray(value) ? value : value ? String(value).split(/\s+/) : [];

function parseMemory(value) {
  if (typeof value === "number") return value;
  const match = String(value ?? "").match(/^(\d+(?:\.\d+)?)\s*([KMG])?B?$/i);
  if (!match) return null;
  const scale = { K: 1024, M: 1024 ** 2, G: 1024 ** 3 };
  return Math.round(+match[1] * (match[2] ? scale[match[2].toUpperCase()] : 1));
}

// Linux-only; elsewhere (dev on macOS) the memory watchdog quietly does nothing.
function rssBytes(pid) {
  try {
    const fields = fs.readFileSync(`/proc/${pid}/statm`, "utf8").split(" ");
    return Number(fields[1]) * 4096;
  } catch {
    return null;
  }
}

// stderr, so stdout stays purely the apps' own output and a log pipeline parsing
// the back-end's JSON lines doesn't trip over ours.
const log = (message) => console.error(`[run-apps] ${message}`);

const { only, configPath } = parseArgs(process.argv.slice(2));
if (!configPath) {
  console.error(
    "usage: run-apps.js start <ecosystem.config.js> [--only <app>]",
  );
  process.exit(1);
}

const resolvedConfig = path.resolve(configPath);
const rootDir = path.dirname(resolvedConfig);
const apps = (require(resolvedConfig).apps || []).filter(
  (app) => !only || app.name === only,
);

if (!apps.length) {
  console.error(
    `No apps to run in ${configPath}${only ? ` matching --only ${only}` : ""}`,
  );
  process.exit(1);
}

// name identifies a process everywhere below, so a missing or repeated one makes
// the bookkeeping incoherent rather than merely odd.
const names = new Set();
for (const app of apps) {
  if (typeof app.name !== "string" || !app.name) {
    console.error(`Every app needs a name; found ${JSON.stringify(app.name)}`);
    process.exit(1);
  }
  if (names.has(app.name)) {
    console.error(`Duplicate app name ${JSON.stringify(app.name)}`);
    process.exit(1);
  }
  names.add(app.name);
}

// Reject an unusable limit at startup rather than let it crash-loop the container.
const limits = new Map();
for (const app of apps) {
  if ((app.max_memory_restart ?? null) === null) continue;
  const limit = parseMemory(app.max_memory_restart);
  if (limit === null || limit < MIN_MEMORY_BYTES) {
    console.error(
      `${app.name}: max_memory_restart ${JSON.stringify(app.max_memory_restart)} ` +
        `is unusable; expected at least ${MIN_MEMORY_BYTES / 1024 ** 2}M, like "512M" or "6G"`,
    );
    process.exit(1);
  }
  limits.set(app.name, limit);
}

// pm2 accepted far more than we implement, so a config carried over from it can
// quietly mean something different. Say which parts we're dropping.
const HONOURED = new Set([
  "name",
  "script",
  "args",
  "cwd",
  "node_args",
  "autorestart",
  "max_memory_restart",
]);
for (const app of apps) {
  if (app.instances > 1) {
    log(`${app.name}: instances=${app.instances} unsupported, starting one`);
  }
  const dropped = Object.keys(app).filter(
    (key) => !HONOURED.has(key) && key !== "instances",
  );
  if (dropped.length) log(`${app.name}: ignoring ${dropped.join(", ")}`);
}

const running = new Map();
const restartTimes = new Map();
let pendingRestarts = 0;
let shuttingDown = false;
let shutdownCode = 0;

// A process that keeps dying won't be fixed by restarting it again, so hand the
// backoff to whatever supervises the container instead of spinning in here.
function inRestartLoop(app) {
  const now = Date.now();
  const recent = (restartTimes.get(app.name) ?? []).filter(
    (at) => now - at < RESTART_WINDOW_MS,
  );
  recent.push(now);
  restartTimes.set(app.name, recent);
  return recent.length > MAX_RESTARTS_PER_WINDOW;
}

function finish(code) {
  log(`all apps stopped, exiting ${code}`);
  process.exit(code);
}

function start(app) {
  const child = spawn(
    process.execPath,
    [...toArray(app.node_args), app.script, ...toArray(app.args)],
    {
      cwd: app.cwd ? path.resolve(rootDir, app.cwd) : rootDir,
      stdio: "inherit",
    },
  );

  running.set(app.name, child);
  log(`started ${app.name} (pid ${child.pid})`);

  child.on("error", (err) => {
    log(`${app.name} failed to start: ${err.message}`);
    onExit(app, child, 1, null);
  });
  child.on("exit", (code, signal) => onExit(app, child, code, signal));
}

// Keyed on the child, not the name: a late event from a replaced process must not
// evict the one now running under that name.
function onExit(app, child, code, signal) {
  if (running.get(app.name) !== child) return;
  running.delete(app.name);
  log(`${app.name} exited (code ${code}, signal ${signal})`);

  if (shuttingDown) {
    if (!running.size) finish(shutdownCode);
    return;
  }

  if (app.autorestart || app.forceRestart) {
    app.forceRestart = false;
    if (inRestartLoop(app)) {
      return shutdown(
        `${app.name} restarted ${MAX_RESTARTS_PER_WINDOW + 1} times in under ` +
          `${RESTART_WINDOW_MS / 1000}s`,
        3,
      );
    }
    pendingRestarts++;
    setTimeout(() => {
      pendingRestarts--;
      if (!shuttingDown) start(app);
    }, RESTART_DELAY_MS);
    return;
  }

  // pm2-runtime stays up until every app is down; match that so a multi-app
  // container isn't torn down by one app crashing.
  if (!running.size && !pendingRestarts) finish(2);
}

// The back-end's SIGTERM handler waits on `server.close()`, which never returns
// while a long request is in flight, so every stop needs the SIGKILL fallback.
function stop(child) {
  if (child.stopping) return;
  child.stopping = true;
  child.kill("SIGTERM");
  setTimeout(() => child.kill("SIGKILL"), KILL_TIMEOUT_MS).unref();
}

function shutdown(reason, code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  shutdownCode = code;
  log(`${reason}, stopping ${running.size} app(s)`);
  if (!running.size) finish(code);

  for (const child of running.values()) stop(child);
}

process.on("SIGTERM", () => shutdown("SIGTERM received"));
process.on("SIGINT", () => shutdown("SIGINT received"));

setInterval(() => {
  for (const [name, child] of running) {
    const limit = limits.get(name);
    const rss = limit ? rssBytes(child.pid) : null;
    if (rss !== null && rss > limit) {
      log(`${name} over max_memory_restart (${rss} > ${limit}), restarting`);
      apps.find((app) => app.name === name).forceRestart = true;
      stop(child);
    }
  }
}, MEMORY_POLL_MS).unref();

apps.forEach(start);

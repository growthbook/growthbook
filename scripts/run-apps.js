#!/usr/bin/env node
// Foreground process supervisor for the container image, in place of pm2-runtime.
// Accepts pm2-runtime's argv shape (`start <config> [--only <app>]`) and the subset
// of ecosystem.config.js fields we actually use: name, script, args, cwd, node_args,
// autorestart, max_memory_restart.

"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const KILL_TIMEOUT_MS = Number(process.env.APP_KILL_TIMEOUT_MS) || 5000;
const RESTART_DELAY_MS = 1000;
const MEMORY_POLL_MS = 10000;

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

const log = (message) => console.log(`[run-apps] ${message}`);

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

const running = new Map();
let pendingRestarts = 0;
let shuttingDown = false;

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
    console.error(`[run-apps] ${app.name} failed to start: ${err.message}`);
    onExit(app, 1, null);
  });
  child.on("exit", (code, signal) => onExit(app, code, signal));
}

function onExit(app, code, signal) {
  if (running.get(app.name) === undefined) return; // 'error' already handled it
  running.delete(app.name);
  log(`${app.name} exited (code ${code}, signal ${signal})`);

  if (shuttingDown) {
    if (!running.size) finish(0);
    return;
  }

  if (app.autorestart || app.forceRestart) {
    app.forceRestart = false;
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

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`${signal} received, stopping ${running.size} app(s)`);
  if (!running.size) finish(0);

  for (const child of running.values()) stop(child);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

const limits = new Map(
  apps
    .map((app) => [app.name, parseMemory(app.max_memory_restart)])
    .filter(([, limit]) => limit),
);

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

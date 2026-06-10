import { ChildProcess, fork } from "child_process";
import * as path from "path";
import { parseEnvInt } from "shared/util";
import { logger } from "back-end/src/util/logger";
import type { SandboxEvalOptions, SandboxEvalResult } from "./sandbox-core";

// Pool of disposable child processes — a worker crash/OOM/hang takes down only that worker.

const POOL_SIZE = parseEnvInt(process.env.CUSTOM_HOOK_POOL_SIZE, 2, {
  min: 1,
  name: "CUSTOM_HOOK_POOL_SIZE",
});
// Hard per-worker heap cap (V8 old space). An OOM kills the worker, not the server.
const WORKER_HEAP_MB = parseEnvInt(
  process.env.CUSTOM_HOOK_WORKER_HEAP_MB,
  256,
  { min: 16, name: "CUSTOM_HOOK_WORKER_HEAP_MB" },
);
// Recycle a worker after this many jobs so any slow growth can't accumulate.
const MAX_JOBS_PER_WORKER = parseEnvInt(
  process.env.CUSTOM_HOOK_MAX_JOBS_PER_WORKER,
  50,
  { min: 1, name: "CUSTOM_HOOK_MAX_JOBS_PER_WORKER" },
);
// Max number of jobs waiting for a free worker before we shed load.
const MAX_QUEUE = parseEnvInt(process.env.CUSTOM_HOOK_MAX_QUEUE, 100, {
  min: 1,
  name: "CUSTOM_HOOK_MAX_QUEUE",
});
const WALL_TIMEOUT_MS = parseEnvInt(
  process.env.CUSTOM_HOOK_WALL_TIMEOUT_MS,
  5000,
  { min: 1, name: "CUSTOM_HOOK_WALL_TIMEOUT_MS" },
);
// Grace beyond the wall timeout before we SIGKILL an unresponsive worker.
const KILL_GRACE_MS = parseEnvInt(process.env.CUSTOM_HOOK_KILL_GRACE_MS, 2000, {
  min: 1,
  name: "CUSTOM_HOOK_KILL_GRACE_MS",
});

// Worker sibling module, matching this file's extension (.ts dev / .js compiled).
const WORKER_PATH =
  process.env.CUSTOM_HOOK_WORKER_PATH ||
  path.join(
    __dirname,
    `sandbox-worker${__filename.endsWith(".ts") ? ".ts" : ".js"}`,
  );

interface Job {
  id: number;
  code: string;
  args: Record<string, unknown>;
  opts?: SandboxEvalOptions;
  resolve: (result: SandboxEvalResult) => void;
}

interface Worker {
  proc: ChildProcess;
  busy: boolean;
  jobsHandled: number;
  generation: number;
  current?: { job: Job; killTimer: ReturnType<typeof setTimeout> };
}

let workers: Worker[] = [];
const queue: Job[] = [];
let jobCounter = 0;
let started = false;
let shuttingDown = false;
// Bumped on (re)start so handleExit can ignore workers from a torn-down pool.
let generation = 0;

function spawnWorker(): Worker {
  // Keep the parent's runtime flags but override the heap cap.
  const execArgv = [
    ...process.execArgv.filter((a) => !a.startsWith("--max-old-space-size")),
    `--max-old-space-size=${WORKER_HEAP_MB}`,
  ];

  const proc = fork(WORKER_PATH, [], {
    execArgv,
    serialization: "advanced",
    // Discard stdin/stdout; keep stderr so crashes surface in logs. ipc for jobs/results.
    stdio: ["ignore", "ignore", "inherit", "ipc"],
  });

  const worker: Worker = { proc, busy: false, jobsHandled: 0, generation };

  proc.on("message", (msg: { id: number; result: SandboxEvalResult }) => {
    const cur = worker.current;
    if (!cur || cur.job.id !== msg.id) return; // stale/duplicate
    clearTimeout(cur.killTimer);
    worker.current = undefined;
    worker.busy = false;
    cur.job.resolve(msg.result);
    if (worker.jobsHandled >= MAX_JOBS_PER_WORKER) {
      recycle(worker);
    }
    dispatch();
  });

  proc.on("exit", (code, signal) => handleExit(worker, code, signal));
  proc.on("error", (err) => {
    logger.error(err, "Custom hook sandbox worker error");
  });

  return worker;
}

function handleExit(
  worker: Worker,
  code: number | null,
  signal: NodeJS.Signals | null,
) {
  workers = workers.filter((w) => w !== worker);

  const cur = worker.current;
  if (cur) {
    // Worker died mid-job (crash/OOM/kill) — fail just this job; the server keeps running.
    clearTimeout(cur.killTimer);
    worker.current = undefined;
    logger.warn(
      { code, signal, jobId: cur.job.id },
      "Custom hook sandbox worker exited mid-job (crash, OOM, or timeout); failing the job",
    );
    cur.job.resolve({
      ok: false,
      error:
        "Custom hook: sandbox terminated unexpectedly (possible crash, out-of-memory, or timeout)",
      warnings: [],
    });
  }

  // Ignore exits from a torn-down generation (the job, if any, was failed above).
  if (worker.generation !== generation) return;

  if (!shuttingDown && started) {
    if (workers.length < POOL_SIZE) workers.push(spawnWorker());
    dispatch();
  }
}

// Gracefully retire a worker; the exit handler removes and respawns it.
function recycle(worker: Worker) {
  if (worker.current) return; // only when idle
  // Remove now so dispatch() can't pick it between SIGTERM and the async exit.
  workers = workers.filter((w) => w !== worker);
  try {
    worker.proc.kill();
  } catch {
    /* already gone */
  }
}

function dispatch() {
  if (shuttingDown || !queue.length) return;

  let worker = workers.find((w) => !w.busy && w.proc.connected);
  if (!worker) {
    if (workers.length < POOL_SIZE) {
      worker = spawnWorker();
      workers.push(worker);
    } else {
      return; // all busy; a freeing worker will re-dispatch
    }
  }

  const job = queue.shift();
  if (!job) return;

  worker.busy = true;
  worker.jobsHandled++;

  const wallTimeout = job.opts?.wallTimeoutMS ?? WALL_TIMEOUT_MS;
  const killTimer = setTimeout(() => {
    logger.warn(
      { jobId: job.id },
      "Custom hook sandbox worker did not respond in time; killing it",
    );
    try {
      worker?.proc.kill("SIGKILL");
    } catch {
      /* already gone */
    }
    // handleExit resolves the job and respawns.
  }, wallTimeout + KILL_GRACE_MS);

  worker.current = { job, killTimer };

  try {
    worker.proc.send({
      id: job.id,
      code: job.code,
      args: job.args,
      opts: job.opts,
    });
  } catch (e) {
    // Couldn't hand off (e.g. non-cloneable args or dead channel).
    clearTimeout(killTimer);
    worker.current = undefined;
    worker.busy = false;
    job.resolve({
      ok: false,
      error: `Custom hook: failed to dispatch to sandbox (${
        e instanceof Error ? e.message : String(e)
      })`,
      warnings: [],
    });
    recycle(worker);
    dispatch();
  }
}

function ensureStarted() {
  if (started) return;
  started = true;
  generation++;
  for (let i = 0; i < POOL_SIZE; i++) workers.push(spawnWorker());
  process.once("exit", shutdown);
}

function shutdown() {
  shuttingDown = true;
  for (const w of workers) {
    try {
      w.proc.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  }
  workers = [];
}

// Drop-in for sandboxEval; never rejects (resolves { ok: false } on failure/crash/timeout).
export function runInSandbox(
  code: string,
  args: Record<string, unknown>,
  opts?: SandboxEvalOptions,
): Promise<SandboxEvalResult> {
  ensureStarted();
  return new Promise<SandboxEvalResult>((resolve) => {
    if (queue.length >= MAX_QUEUE) {
      resolve({
        ok: false,
        error: "Custom hook: sandbox is overloaded, please try again",
        warnings: [],
      });
      return;
    }
    queue.push({ id: ++jobCounter, code, args, opts, resolve });
    dispatch();
  });
}

// Exposed for tests/diagnostics.
export function __shutdownSandboxPool() {
  shutdown();
  // Allow a fresh start afterwards (used by tests).
  shuttingDown = false;
  started = false;
}

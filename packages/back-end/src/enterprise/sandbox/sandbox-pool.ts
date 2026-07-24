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
// Fallback boot confirmation: a worker that survives this long without sending its
// "ready" handshake (e.g. an older worker build mid-deploy) is still treated as
// booted. Set above the real boot time so a slow boot isn't misclassified.
const MIN_HEALTHY_UPTIME_MS = parseEnvInt(
  process.env.CUSTOM_HOOK_MIN_HEALTHY_UPTIME_MS,
  2000,
  { min: 1, name: "CUSTOM_HOOK_MIN_HEALTHY_UPTIME_MS" },
);
// Backoff between respawns after boot failures, to avoid a fork→crash→fork storm
// that pegs CPU and starves the event loop (tripping liveness probes).
const RESPAWN_BACKOFF_BASE_MS = parseEnvInt(
  process.env.CUSTOM_HOOK_RESPAWN_BACKOFF_MS,
  250,
  { min: 1, name: "CUSTOM_HOOK_RESPAWN_BACKOFF_MS" },
);
const RESPAWN_BACKOFF_MAX_MS = parseEnvInt(
  process.env.CUSTOM_HOOK_RESPAWN_BACKOFF_MAX_MS,
  30000,
  { min: 1, name: "CUSTOM_HOOK_RESPAWN_BACKOFF_MAX_MS" },
);
// Consecutive boot failures that trip the crash-loop breaker.
const CRASH_LOOP_THRESHOLD = parseEnvInt(
  process.env.CUSTOM_HOOK_CRASH_LOOP_THRESHOLD,
  5,
  { min: 1, name: "CUSTOM_HOOK_CRASH_LOOP_THRESHOLD" },
);
// While the breaker is open we stop respawning and fail jobs fast; after this cooldown
// we allow a single half-open trial worker to test whether the issue has cleared.
const CIRCUIT_COOLDOWN_MS = parseEnvInt(
  process.env.CUSTOM_HOOK_CIRCUIT_COOLDOWN_MS,
  30000,
  { min: 1, name: "CUSTOM_HOOK_CIRCUIT_COOLDOWN_MS" },
);

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

// Messages a worker sends to the pool: a one-time boot handshake, then job results.
type WorkerMessage =
  | { ready: true }
  | { id: number; result: SandboxEvalResult };

interface Worker {
  proc: ChildProcess;
  busy: boolean;
  jobsHandled: number;
  generation: number;
  // Set once the worker proves it booted (sent its "ready" signal, answered a job,
  // or survived the uptime fallback). An exit before this is a boot failure, even
  // if a job was in flight; an exit after it is a normal mid-job crash.
  bootConfirmed: boolean;
  // Uptime fallback that confirms boot if no "ready"/result arrives (e.g. an older
  // worker build during a rolling deploy).
  bootTimer?: ReturnType<typeof setTimeout>;
  current?: { job: Job; killTimer: ReturnType<typeof setTimeout> };
}

let workers: Worker[] = [];
const queue: Job[] = [];
let jobCounter = 0;
let started = false;
let shuttingDown = false;
// Bumped on (re)start so handleExit can ignore workers from a torn-down pool.
let generation = 0;
// Crash-loop breaker state.
let consecutiveBootFailures = 0;
let circuitOpenUntil = 0;
let replenishTimer: ReturnType<typeof setTimeout> | null = null;

// Matches the `--require`/`-r` preload that bootstraps a tracing SDK
// (tracing.opentelemetry / tracing.datadog), in either spelling:
//   "--require <module>"  ->  the value is the module path
//   "--require=<module>"  ->  flag and value combined
const TRACING_MODULE_RE = /tracing\.(?:opentelemetry|datadog)/;

// The parent boots a tracing SDK via `node --require .../tracing.*.js`. A forked
// worker inherits that flag through process.execArgv, so without this it would
// re-bootstrap a full OpenTelemetry/Datadog SDK + auto-instrumentation in every
// child (duplicate exporters/timers, child_process instrumentation nesting, slow
// or failing boots). We want tracing only in the parent — the meaningful span is
// the runInSandbox call there — so strip the tracing preload from the worker.
export function workerExecArgv(parent: string[] = process.execArgv): string[] {
  const out: string[] = [];
  for (let i = 0; i < parent.length; i++) {
    const arg = parent[i];
    // Re-added below with the worker's own heap cap.
    if (arg.startsWith("--max-old-space-size")) continue;
    if (arg === "--require" || arg === "-r") {
      // Drop the flag and its value when the value is a tracing module; keep
      // any other preload (e.g. a TS loader in dev).
      if (TRACING_MODULE_RE.test(parent[i + 1] ?? "")) {
        i++;
        continue;
      }
      out.push(arg);
      continue;
    }
    if (
      (arg.startsWith("--require=") || arg.startsWith("-r=")) &&
      TRACING_MODULE_RE.test(arg)
    ) {
      continue;
    }
    out.push(arg);
  }
  out.push(`--max-old-space-size=${WORKER_HEAP_MB}`);
  return out;
}

// Strip any tracing preload that came in via NODE_OPTIONS and hard-disable the
// SDKs, so the worker can't bootstrap tracing by any path.
export function workerEnv(
  parentEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...parentEnv,
    OTEL_SDK_DISABLED: "true",
    DD_TRACE_ENABLED: "false",
  };
  if (env.NODE_OPTIONS) {
    const scrubbed = env.NODE_OPTIONS.replace(
      /(?:--require|-r)(?:=|\s+)\S*tracing\.(?:opentelemetry|datadog)\S*/g,
      "",
    ).trim();
    if (scrubbed) env.NODE_OPTIONS = scrubbed;
    else delete env.NODE_OPTIONS;
  }
  return env;
}

function spawnWorker(): Worker {
  const proc = fork(WORKER_PATH, [], {
    execArgv: workerExecArgv(),
    env: workerEnv(),
    serialization: "advanced",
    // Discard stdin/stdout; keep stderr so crashes surface in logs. ipc for jobs/results.
    stdio: ["ignore", "ignore", "inherit", "ipc"],
  });

  const worker: Worker = {
    proc,
    busy: false,
    jobsHandled: 0,
    generation,
    bootConfirmed: false,
  };

  // Fallback in case "ready" never arrives: surviving the uptime window also counts
  // as a healthy boot.
  worker.bootTimer = setTimeout(
    () => confirmBoot(worker),
    MIN_HEALTHY_UPTIME_MS,
  );
  worker.bootTimer.unref();

  proc.on("message", (msg: WorkerMessage) => {
    // The worker's "ready" handshake (or any job result) proves it booted.
    confirmBoot(worker);
    if ("ready" in msg) return;
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

// Mark a worker as having booted successfully. Since the boot path works, also reset
// the crash-loop breaker and resume normal respawning.
function confirmBoot(worker: Worker) {
  // Clear the uptime fallback so it can't fire later and reset the breaker a second
  // time (mid-streak) while other workers are crash-looping.
  if (worker.bootTimer) {
    clearTimeout(worker.bootTimer);
    worker.bootTimer = undefined;
  }
  worker.bootConfirmed = true;
  if (consecutiveBootFailures === 0 && circuitOpenUntil === 0) return;
  consecutiveBootFailures = 0;
  circuitOpenUntil = 0;
  ensureCapacity();
}

function failAllQueued(error: string) {
  while (queue.length) {
    queue.shift()?.resolve({ ok: false, error, warnings: [] });
  }
}

function handleExit(
  worker: Worker,
  code: number | null,
  signal: NodeJS.Signals | null,
) {
  workers = workers.filter((w) => w !== worker);
  if (worker.bootTimer) {
    clearTimeout(worker.bootTimer);
    worker.bootTimer = undefined;
  }

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

  if (!worker.bootConfirmed) {
    // Worker exited before confirming boot — likely a boot failure that repeats on
    // respawn (bad worker path, missing native module, OOM-on-load). Counting it even
    // when a job was in flight means the breaker still opens under sustained load.
    consecutiveBootFailures++;
    logger.error(
      { code, signal, consecutiveBootFailures },
      "Custom hook sandbox worker failed to boot",
    );
    if (
      consecutiveBootFailures >= CRASH_LOOP_THRESHOLD &&
      circuitOpenUntil <= Date.now()
    ) {
      circuitOpenUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
      logger.error(
        { cooldownMs: CIRCUIT_COOLDOWN_MS },
        "Custom hook sandbox crash-loop detected; pausing respawns and failing jobs fast",
      );
      failAllQueued(
        "Custom hook: sandbox temporarily unavailable (worker keeps crashing)",
      );
    }
  }

  // Ignore exits from a torn-down generation (the job, if any, was failed above).
  if (worker.generation !== generation) return;

  if (!shuttingDown && started) {
    ensureCapacity();
    dispatch();
  }
}

// Refill the pool toward POOL_SIZE, but throttle respawns while boot failures are
// happening: back off between attempts and, once the breaker is open, wait out the
// cooldown before a single half-open trial worker.
function ensureCapacity() {
  if (shuttingDown || !started || replenishTimer) return;
  if (workers.length >= POOL_SIZE) return;

  const now = Date.now();
  let delay = 0;
  if (circuitOpenUntil > now) {
    delay = circuitOpenUntil - now;
  } else if (consecutiveBootFailures > 0) {
    delay = Math.min(
      RESPAWN_BACKOFF_BASE_MS * 2 ** (consecutiveBootFailures - 1),
      RESPAWN_BACKOFF_MAX_MS,
    );
  }

  replenishTimer = setTimeout(() => {
    replenishTimer = null;
    if (shuttingDown || !started) return;
    if (workers.length < POOL_SIZE) {
      workers.push(spawnWorker());
      dispatch();
    }
    // While healthy, fill the rest of the pool immediately; while degraded, spawn one
    // at a time and let each worker's outcome drive the next attempt.
    if (workers.length < POOL_SIZE && consecutiveBootFailures === 0) {
      ensureCapacity();
    }
  }, delay);
  replenishTimer.unref();
}

// Gracefully retire a worker; the exit handler removes and respawns it.
function recycle(worker: Worker) {
  if (worker.current) return; // only when idle
  // Remove now so dispatch() can't pick it between SIGTERM and the async exit.
  workers = workers.filter((w) => w !== worker);
  if (worker.bootTimer) {
    clearTimeout(worker.bootTimer);
    worker.bootTimer = undefined;
  }
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
    // Only spawn on demand when healthy. While boot failures are happening (breaker
    // open, or backing off before it opens) respawns go through ensureCapacity's
    // throttle so we don't add to a fork→crash storm.
    if (
      workers.length < POOL_SIZE &&
      circuitOpenUntil <= Date.now() &&
      consecutiveBootFailures === 0
    ) {
      worker = spawnWorker();
      workers.push(worker);
    } else {
      // All busy, or respawns are throttled; a freeing or respawned worker
      // re-dispatches. Make sure a refill is scheduled so the queue drains.
      ensureCapacity();
      return;
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
  if (replenishTimer) {
    clearTimeout(replenishTimer);
    replenishTimer = null;
  }
  for (const w of workers) {
    if (w.bootTimer) clearTimeout(w.bootTimer);
    if (w.current) clearTimeout(w.current.killTimer);
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
    // Breaker open: workers keep failing to boot, so fail fast instead of queueing.
    if (circuitOpenUntil > Date.now()) {
      resolve({
        ok: false,
        error:
          "Custom hook: sandbox temporarily unavailable (worker keeps crashing), please try again shortly",
        warnings: [],
      });
      return;
    }
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
  consecutiveBootFailures = 0;
  circuitOpenUntil = 0;
}

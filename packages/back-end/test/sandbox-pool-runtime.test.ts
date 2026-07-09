import * as path from "path";

// Integration tests for the worker pool's runtime behavior (boot handshake,
// job round-trip, crash-loop breaker). These fork real child processes, so they
// use plain-.js fixture workers (the real worker is .ts and can't be forked under
// ts-jest). The pool reads its config from env at module load, so each test sets
// env then loads a fresh module instance.

const FIXTURES = path.join(__dirname, "fixtures", "sandbox");
const HEALTHY_WORKER = path.join(FIXTURES, "healthy-worker.js");
const CRASH_WORKER = path.join(FIXTURES, "boot-crash-worker.js");

type Pool = typeof import("../src/enterprise/sandbox/sandbox-pool");

const POOL_ENV_KEYS = [
  "CUSTOM_HOOK_WORKER_PATH",
  "CUSTOM_HOOK_POOL_SIZE",
  "CUSTOM_HOOK_CRASH_LOOP_THRESHOLD",
  "CUSTOM_HOOK_RESPAWN_BACKOFF_MS",
  "CUSTOM_HOOK_RESPAWN_BACKOFF_MAX_MS",
  "CUSTOM_HOOK_CIRCUIT_COOLDOWN_MS",
  "CUSTOM_HOOK_MIN_HEALTHY_UPTIME_MS",
];

async function loadPool(env: Record<string, string>): Promise<Pool> {
  jest.resetModules();
  for (const k of POOL_ENV_KEYS) delete process.env[k];
  Object.assign(process.env, env);
  return import("../src/enterprise/sandbox/sandbox-pool");
}

describe("sandbox pool runtime", () => {
  let pool: Pool | null = null;

  afterEach(() => {
    pool?.__shutdownSandboxPool();
    pool = null;
    for (const k of POOL_ENV_KEYS) delete process.env[k];
  });

  it("boots a worker, completes a job, and returns its result", async () => {
    pool = await loadPool({
      CUSTOM_HOOK_WORKER_PATH: HEALTHY_WORKER,
      CUSTOM_HOOK_POOL_SIZE: "1",
    });

    const result = await pool.runInSandbox("unused", { n: 41 });

    expect(result).toEqual({
      ok: true,
      returnVal: 41,
      log: "",
      warnings: [],
    });
  });

  it("serves multiple sequential jobs from the pool", async () => {
    pool = await loadPool({
      CUSTOM_HOOK_WORKER_PATH: HEALTHY_WORKER,
      CUSTOM_HOOK_POOL_SIZE: "2",
    });

    const results = await Promise.all([
      pool.runInSandbox("unused", { n: 1 }),
      pool.runInSandbox("unused", { n: 2 }),
      pool.runInSandbox("unused", { n: 3 }),
    ]);

    expect(results.map((r) => (r.ok ? r.returnVal : null))).toEqual([1, 2, 3]);
  });

  it("opens the crash-loop breaker and fails fast after repeated boot failures", async () => {
    pool = await loadPool({
      CUSTOM_HOOK_WORKER_PATH: CRASH_WORKER,
      CUSTOM_HOOK_POOL_SIZE: "1",
      CUSTOM_HOOK_CRASH_LOOP_THRESHOLD: "3",
      CUSTOM_HOOK_RESPAWN_BACKOFF_MS: "1",
      CUSTOM_HOOK_RESPAWN_BACKOFF_MAX_MS: "5",
      // Keep the breaker open long enough to assert against once tripped.
      CUSTOM_HOOK_CIRCUIT_COOLDOWN_MS: "5000",
      // High, so the uptime fallback never confirms a (crashing) worker as booted.
      CUSTOM_HOOK_MIN_HEALTHY_UPTIME_MS: "100000",
    });

    // Workers crash on boot; jobs fail (terminated mid-job or, once the breaker is
    // open, fast-failed). Poll until we observe the breaker's fast-fail.
    const deadline = Date.now() + 10000;
    let breakerError: string | undefined;
    while (Date.now() < deadline) {
      const r = await pool.runInSandbox("unused", {});
      expect(r.ok).toBe(false);
      if (!r.ok && r.error.includes("temporarily unavailable")) {
        breakerError = r.error;
        break;
      }
    }

    expect(breakerError).toContain("temporarily unavailable");

    // While open, a subsequent call fast-fails immediately with the same error.
    const fast = await pool.runInSandbox("unused", {});
    expect(fast.ok).toBe(false);
    expect(fast.ok ? "" : fast.error).toContain("temporarily unavailable");
  }, 15000);
});

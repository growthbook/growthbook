// eslint-disable-next-line no-restricted-imports
import "../../init/aliases";
import {
  sandboxEval,
  SandboxEvalOptions,
  SandboxEvalResult,
} from "./sandbox-core";

interface WorkerJob {
  id: number;
  code: string;
  args: Record<string, unknown>;
  opts?: SandboxEvalOptions;
}

interface WorkerResponse {
  id: number;
  result: SandboxEvalResult;
}

// If launched without an IPC channel there's nothing to do.
if (!process.send) {
  process.exit(0);
}

// Exit if the parent goes away, so we never become an orphan.
process.on("disconnect", () => process.exit(0));

// Reaching here means all imports (incl. isolated-vm) loaded, so the boot
// succeeded. Tell the pool so it can tell a boot failure (crash before ready)
// apart from a user-code crash (after ready) and gate its crash-loop breaker.
process.send?.({ ready: true });

process.on("message", async (job: WorkerJob) => {
  let result: SandboxEvalResult;
  try {
    result = await sandboxEval(job.code, job.args, job.opts);
  } catch (e) {
    result = {
      ok: false,
      error: `Custom hook: ${e instanceof Error ? e.message : String(e)}`,
      warnings: [],
    };
  }
  const response: WorkerResponse = { id: job.id, result };
  try {
    process.send?.(response);
  } catch {
    // Parent is gone; nothing we can do.
  }
});

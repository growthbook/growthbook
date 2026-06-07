import {
  sandboxEval,
  SandboxEvalOptions,
  SandboxEvalResult,
} from "./sandbox-core";

// Forked child process that runs custom hook code in an isolated-vm sandbox,
// one job at a time, communicating with the parent over IPC. Running in a
// separate OS process means a hard crash (OOM abort, native fault) or a hung
// run kills only this worker — the parent (SandboxPool) detects the exit and
// fails just that job, keeping the API server alive.
//
// This file imports only sandbox-core (which is intentionally light), so each
// worker boots without the full back-end module graph.

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

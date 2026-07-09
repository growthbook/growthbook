import { v4 as uuidv4 } from "uuid";
import { logger } from "back-end/src/util/logger";

// In-memory state machine for a single AI edit turn that may yield
// DOM-side tool calls back to the extension between HTTP requests.
//
// Lifecycle:
//   1. /edit creates a job, starts an LLM generateText Promise. Its tool
//      `execute()` functions defer to job.requestFromClient() — they
//      block until the corresponding resume call provides a result.
//   2. /edit races the generation Promise against job.nextToolCallReady().
//      Whichever resolves first determines the response: a tool call to
//      the client OR the final LLM output.
//   3. /edit/resume looks up the job, resolves the pending tool call's
//      deferred Promise with the result, re-runs the race, and returns.
//   4. Repeat until the generation Promise wins the race (final output)
//      or the job times out / aborts.
//
// Cleanup: jobs are garbage-collected after JOB_TTL_MS if never resumed
// (network drop, side-panel closed mid-turn, etc.). The Set sweep is
// cheap — a single chat turn rarely has more than a handful of jobs in
// flight per server instance.
//
// Multi-instance caveat: in-memory state means the resume request MUST
// hit the same back-end process. Cloud uses cookie-stickiness on the LB
// for this; self-hosted single-instance is naturally fine. A multi-
// instance self-hosted deploy without affinity will see "job not found"
// errors on resume — documented in the visual-editor docs.

const JOB_TTL_MS = 5 * 60 * 1000;
const JOB_SWEEP_INTERVAL_MS = 30 * 1000;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}

function defer<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// What the request handler returns to the client. Either a yield (tool
// call) or the resolved LLM output.
export type RaceOutcome<TFinal> =
  | { kind: "toolCall"; callId: string; tool: string; args: unknown }
  | { kind: "final"; payload: TFinal }
  | { kind: "error"; error: string };

interface PendingToolCall {
  callId: string;
  tool: string;
  args: unknown;
  // Resolves when the resume endpoint provides this tool's result. The
  // tool's execute() function awaits this Promise.
  resultDeferred: Deferred<unknown>;
}

export class ClientJob<TFinal> {
  public readonly id: string;
  public readonly createdAt: number;
  public lastActivity: number;
  // Set by the request handler when starting the LLM. Called by both
  // /edit and /edit/resume when the race resolves to "final" — runs
  // validation + retry + sanitize. Kept on the job so the resume
  // endpoint doesn't need to reconstruct trustedSelectors from scratch.
  public finalize: ((raw: TFinal) => Promise<unknown>) | null = null;

  // Set when the LLM is mid-call and a tool is awaiting a client
  // response. Cleared when the resume endpoint resolves it.
  private pendingToolCall: PendingToolCall | null = null;

  // Signals to the request handler that a new tool call is ready to
  // yield. Re-created after every yield.
  private nextToolCallDeferred: Deferred<PendingToolCall>;

  // Wraps the LLM generateText Promise. Resolved when the model emits
  // its final structured output. Rejected on LLM error.
  private generationPromise: Promise<TFinal> | null = null;

  private aborted = false;

  constructor() {
    this.id = uuidv4();
    this.createdAt = Date.now();
    this.lastActivity = this.createdAt;
    this.nextToolCallDeferred = defer<PendingToolCall>();
  }

  // Attach the LLM generation Promise. Called once after the toolset
  // is built and generateText is fired.
  setGenerationPromise(p: Promise<TFinal>): void {
    this.generationPromise = p;
    // Defensive: if the LLM rejects without ever calling a tool, the
    // race below resolves to "final" via this catch — without it the
    // tool-call side would hang forever.
    p.catch(() => {
      // Surface as a "final-with-error" outcome via the race; the
      // request handler treats this as an LLM failure.
      if (!this.pendingToolCall) {
        // Don't reject the next-tool-call deferred — that would
        // throw at the await site. Let the generation Promise's
        // rejection propagate through Promise.race naturally.
      }
    });
  }

  // Called from inside a tool's execute(). Registers a pending call,
  // signals the request handler via nextToolCallDeferred, and blocks
  // until the resume endpoint provides a result.
  async requestFromClient(tool: string, args: unknown): Promise<unknown> {
    if (this.aborted) {
      throw new Error("Job aborted.");
    }
    const callId = uuidv4();
    const call: PendingToolCall = {
      callId,
      tool,
      args,
      resultDeferred: defer<unknown>(),
    };
    this.pendingToolCall = call;
    this.nextToolCallDeferred.resolve(call);
    this.lastActivity = Date.now();
    return call.resultDeferred.promise;
  }

  // Called by the resume endpoint. Resolves the tool's awaiter so the
  // LLM continues.
  resolvePendingToolCall(callId: string, result: unknown): boolean {
    const pending = this.pendingToolCall;
    if (!pending || pending.callId !== callId) return false;
    this.pendingToolCall = null;
    // Set up the next deferred BEFORE resolving — the LLM may call
    // another tool synchronously after we resolve, and that tool would
    // try to fire nextToolCallDeferred.resolve(). Without re-creating
    // first, that second resolve hits an already-resolved deferred.
    this.nextToolCallDeferred = defer<PendingToolCall>();
    pending.resultDeferred.resolve(result);
    this.lastActivity = Date.now();
    return true;
  }

  // Race the LLM generation against the next tool call. Whichever
  // resolves first wins. Called by both /edit and /edit/resume.
  async race(): Promise<RaceOutcome<TFinal>> {
    if (!this.generationPromise) {
      return { kind: "error", error: "Job has no active generation." };
    }
    if (this.aborted) {
      return { kind: "error", error: "Job aborted." };
    }
    try {
      const winner = await Promise.race([
        this.generationPromise.then((payload) => ({
          kind: "final" as const,
          payload,
        })),
        this.nextToolCallDeferred.promise.then((tc) => ({
          kind: "toolCall" as const,
          callId: tc.callId,
          tool: tc.tool,
          args: tc.args,
        })),
      ]);
      this.lastActivity = Date.now();
      return winner;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { kind: "error", error: msg };
    }
  }

  abort(reason: string): void {
    if (this.aborted) return;
    this.aborted = true;
    // Resolve the pending tool call's awaiter so the LLM unblocks and
    // its generateText Promise rejects (it'll see the resolved result
    // and continue; if we want a hard kill we'd need AbortSignal
    // wiring on generateText too — defer to a later phase).
    if (this.pendingToolCall) {
      this.pendingToolCall.resultDeferred.reject(new Error(reason));
      this.pendingToolCall = null;
    }
  }

  isStale(now: number): boolean {
    return now - this.lastActivity > JOB_TTL_MS;
  }
}

class ClientJobStore<TFinal> {
  private jobs = new Map<string, ClientJob<TFinal>>();
  private sweeper: NodeJS.Timeout | null = null;

  create(): ClientJob<TFinal> {
    this.ensureSweeper();
    const job = new ClientJob<TFinal>();
    this.jobs.set(job.id, job);
    return job;
  }

  get(id: string): ClientJob<TFinal> | undefined {
    return this.jobs.get(id);
  }

  delete(id: string): void {
    this.jobs.delete(id);
  }

  private ensureSweeper(): void {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => {
      const now = Date.now();
      for (const [id, job] of this.jobs) {
        if (job.isStale(now)) {
          job.abort("Job timed out.");
          this.jobs.delete(id);
          logger.debug({ jobId: id }, "[visual-editor-ai/job] swept stale job");
        }
      }
    }, JOB_SWEEP_INTERVAL_MS);
    // Don't keep the process alive just for this sweeper.
    this.sweeper.unref?.();
  }
}

// Singleton store. One per Node process — fine for single-instance
// deploys; cloud relies on session affinity to route resume calls back
// to the originating instance.
export const aiEditJobStore = new ClientJobStore<unknown>();

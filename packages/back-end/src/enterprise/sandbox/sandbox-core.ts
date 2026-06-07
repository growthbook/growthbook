import { Isolate, Context, Reference, ExternalCopy } from "isolated-vm";
import { RequestInit } from "node-fetch";
import { parseEnvInt } from "shared/util";
import { cancellableFetch } from "back-end/src/util/http.util";
import { IS_CLOUD } from "back-end/src/util/secrets";

// This module is the *pure* isolate runner. It is imported both by the main
// process and by the forked sandbox worker, so it must stay light — do NOT
// import the request context, models, mongoose, etc. here (that would balloon
// every worker's boot footprint). Orchestration lives in sandbox-eval.ts.

// Default memory limit in MB
const MEMORY_MB = parseEnvInt(process.env.CUSTOM_HOOK_MEMORY_MB, 32, {
  min: 1,
  name: "CUSTOM_HOOK_MEMORY_MB",
});
// Max active CPU time (excluding fetch)
const CPU_TIMEOUT_MS = parseEnvInt(
  process.env.CUSTOM_HOOK_CPU_TIMEOUT_MS,
  100,
  {
    min: 1,
    name: "CUSTOM_HOOK_CPU_TIMEOUT_MS",
  },
);
// Max total run time (including fetch)
const WALL_TIMEOUT_MS = parseEnvInt(
  process.env.CUSTOM_HOOK_WALL_TIMEOUT_MS,
  5000,
  { min: 1, name: "CUSTOM_HOOK_WALL_TIMEOUT_MS" },
);
// Max response size from fetch calls (default 500KB)
const MAX_FETCH_RESP_SIZE = parseEnvInt(
  process.env.CUSTOM_HOOK_MAX_FETCH_RESP_SIZE,
  500 * 1024,
  { min: 1, name: "CUSTOM_HOOK_MAX_FETCH_RESP_SIZE" },
);
// Max total size of captured console.log output, in characters (default 64KB).
// The isolate memory limit only bounds memory *inside* the isolate; data copied
// out to the host (logs/warnings) is unbounded without this cap.
const MAX_LOG_CHARS = parseEnvInt(
  process.env.CUSTOM_HOOK_MAX_LOG_CHARS,
  64 * 1024,
  { min: 1, name: "CUSTOM_HOOK_MAX_LOG_CHARS" },
);
// Max number of warnings raised via addWarning (default 100)
const MAX_WARNINGS = parseEnvInt(process.env.CUSTOM_HOOK_MAX_WARNINGS, 100, {
  min: 1,
  name: "CUSTOM_HOOK_MAX_WARNINGS",
});
// Max total size of all warnings combined, in characters (default 64KB)
const MAX_WARNING_CHARS = parseEnvInt(
  process.env.CUSTOM_HOOK_MAX_WARNING_CHARS,
  64 * 1024,
  { min: 1, name: "CUSTOM_HOOK_MAX_WARNING_CHARS" },
);

export interface SandboxEvalResult {
  ok: boolean;
  error?: string;
  returnVal?: unknown;
  log?: string;
  warnings: string[];
}

export interface SandboxEvalOptions {
  memoryLimitMB?: number;
  cpuTimeoutMS?: number;
  wallTimeoutMS?: number;
  maxFetchRespSize?: number;
}

export async function sandboxEval(
  functionBody: string,
  functionArgs: Record<string, unknown>,
  {
    memoryLimitMB,
    cpuTimeoutMS,
    wallTimeoutMS,
    maxFetchRespSize,
  }: SandboxEvalOptions = {},
): Promise<SandboxEvalResult> {
  // Sanity check. This should be handled by the caller already
  // isolated-vm is not 100% safe in a multi-tenant environment, but should be fine when self-hosting
  if (IS_CLOUD) {
    return {
      ok: false,
      error: "Custom hooks are not supported in GrowthBook Cloud",
      warnings: [],
    };
  }

  const isolate = new Isolate({
    memoryLimit: memoryLimitMB ?? MEMORY_MB,
  });

  const logs: string[] = [];
  const warnings: string[] = [];
  // Track how much we've captured so we can bound host-side memory (the isolate
  // memory limit does not cover data copied out to these arrays).
  let logChars = 0;
  let warningChars = 0;

  // Dispose state, so we can terminate a runaway isolate from the wall-clock
  // timer (async code that yields with `await` escapes the per-run CPU timeout).
  let disposed = false;
  let wallTimer: ReturnType<typeof setTimeout> | undefined;
  const safeDispose = () => {
    if (disposed) return;
    disposed = true;
    try {
      isolate.dispose();
    } catch {
      /* already disposed */
    }
  };

  try {
    const isolateCtx: Context = await isolate.createContext();
    const jail = isolateCtx.global;
    await jail.set("global", jail.derefInto());

    // Same fetch function we use for webhooks (Smokescreen server, max size, timeout)
    const hostFetch = async (url: string, opts: RequestInit = {}) => {
      const res = await cancellableFetch(url, opts, {
        maxContentSize: maxFetchRespSize ?? MAX_FETCH_RESP_SIZE,
        maxTimeMs: wallTimeoutMS ?? WALL_TIMEOUT_MS,
      });

      return {
        ok: res.responseWithoutBody.ok,
        status: res.responseWithoutBody.status,
        statusText: res.responseWithoutBody.statusText,
        _body: res.stringBody,
      };
    };

    // Host -> isolate bridge for fetch
    const fetchRef = new Reference(
      async (url: string, opts: RequestInit = {}) => {
        try {
          const resp = await hostFetch(String(url), opts || {});
          return new ExternalCopy(resp).copyInto();
        } catch (err) {
          return new ExternalCopy({
            _error: String(err.message || err),
          }).copyInto();
        }
      },
    );

    // Host -> isolate bridge for logging.
    // Bounds total captured output so a tight log loop can't exhaust host
    // memory. Enforced here (not just in the shim) because user code can reach
    // this Reference directly.
    const logRef = new Reference((...args: unknown[]) => {
      const remaining = MAX_LOG_CHARS - logChars;
      if (remaining <= 0) return;
      let line = args.map(String).join(" ");
      if (line.length > remaining) {
        line = line.slice(0, remaining) + "…[log truncated]";
      }
      logs.push(line);
      logChars += line.length;
    });

    // Host -> isolate bridge for raising soft warnings.
    // Bounds both the count and the total size of warnings.
    const warnRef = new Reference((msg: unknown) => {
      if (warnings.length >= MAX_WARNINGS) return;
      const remaining = MAX_WARNING_CHARS - warningChars;
      if (remaining <= 0) return;
      let str = String(msg);
      if (str.length > remaining) {
        str = str.slice(0, remaining) + "…[warning truncated]";
      }
      warnings.push(str);
      warningChars += str.length;
    });

    await jail.set("hostFetch", fetchRef);
    await jail.set("hostLog", logRef);
    await jail.set("hostWarn", warnRef);

    // Inject shims for console.log and fetch
    // We aren't aiming for a 100% complete implementation
    // We just need something good enough so copy/pasted code works
    const shimCode = `
      (function() {
        const stringifyLogArgs = (args) => args.map(arg => {
          if (typeof arg === "string") return arg;
          try {
            return JSON.stringify(arg);
          } catch {
            return String(arg);
          }
        });

        globalThis.console = {
          log: (...args) => hostLog.applyIgnored(undefined, ["[log]", ...stringifyLogArgs(args)]),
          error: (...args) => hostLog.applyIgnored(undefined, ["[error]", ...stringifyLogArgs(args)]),
          debug: (...args) => hostLog.applyIgnored(undefined, ["[debug]", ...stringifyLogArgs(args)])
        };
        globalThis.fetch = async (...args) => {
          const { _body, _error, ...rest } = await hostFetch.apply(undefined, args, {
            arguments: { copy: true },
            result: { copy: true, promise: true },
          });
          if (_error) {
            throw new Error(_error);
          }
          return {
            ...rest,
            text: async () => _body,
            json: async () => JSON.parse(_body),
          };
        };
        globalThis.addWarning = (msg) => {
          let str;
          if (typeof msg === "string") {
            str = msg;
          } else {
            try {
              str = JSON.stringify(msg);
            } catch {
              str = String(msg);
            }
          }
          hostWarn.applyIgnored(undefined, [str]);
        };
      })();
    `;
    await isolate.compileScript(shimCode).then((s) => s.run(isolateCtx));

    // Wrap user body into a function and make individual arg keys available as variables
    const wrapped = `
      globalThis.__user_func = async function({${Object.keys(functionArgs).join(", ")}}) {
        ${functionBody}
      };
      "__ready__";
    `;
    await isolate.compileScript(wrapped).then((s) => s.run(isolateCtx));

    const funcRef = (await jail.get("__user_func", {
      reference: true,
    })) as Reference;

    if (!funcRef) {
      throw new Error("Compilation error");
    }

    const dataCopy = new ExternalCopy(functionArgs).copyInto();

    // The `timeout` below only bounds a single *synchronous* run. Async code
    // that yields with `await` resumes unbudgeted, so the wall-clock timer is
    // the authoritative bound — and it must dispose the isolate to actually
    // stop a runaway loop (rejecting the promise alone does not).
    const resultPromise = funcRef.apply(undefined, [dataCopy], {
      arguments: { copy: true },
      result: { copy: true, promise: true },
      timeout: cpuTimeoutMS ?? CPU_TIMEOUT_MS,
    });
    // If the wall timer fires first and disposes the isolate, this promise
    // rejects after the race already settled; swallow the late rejection.
    resultPromise.catch(() => {});

    const wallTimeout = new Promise<never>((_, reject) => {
      wallTimer = setTimeout(() => {
        // Terminate any runaway execution (incl. async loops that evade the
        // CPU timeout) instead of letting it run until `finally`.
        safeDispose();
        reject(new Error("Execution timed out"));
      }, wallTimeoutMS ?? WALL_TIMEOUT_MS);
    });

    const returnVal = await Promise.race([resultPromise, wallTimeout]);
    return { ok: true, returnVal, log: logs.join("\n"), warnings };
  } catch (err) {
    const message = err.message || err || "";
    return {
      ok: false,
      error: message ? `Custom hook: ${message}` : "Custom hook error",
      log: logs.join("\n"),
      warnings,
    };
  } finally {
    if (wallTimer) clearTimeout(wallTimer);
    safeDispose();
  }
}

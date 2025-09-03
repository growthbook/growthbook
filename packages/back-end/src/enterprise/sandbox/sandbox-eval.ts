// sandbox-runner.ts
import { Isolate, Context, Reference, ExternalCopy } from "isolated-vm";
import { RequestInit } from "node-fetch";
import { cancellableFetch } from "back-end/src/util/http.util";
import { IS_CLOUD } from "back-end/src/util/secrets";

const DEFAULT_MEMORY_MB = 32;
const CPU_TIMEOUT_MS = 100; // max active CPU time (excluding fetch)
const WALL_TIMEOUT_MS = 5000; // max total run time (including fetch)
const MAX_FETCH_RESP_SIZE = 500 * 1024; // 500KB max response size from fetch calls

// Same fetch function we use for webhooks (Smokescreen server, max size, timeout)
async function hostFetch(url: string, opts: RequestInit = {}) {
  const res = await cancellableFetch(url, opts, {
    maxContentSize: MAX_FETCH_RESP_SIZE,
    maxTimeMs: WALL_TIMEOUT_MS,
  });

  return {
    ok: res.responseWithoutBody.ok,
    status: res.responseWithoutBody.status,
    statusText: res.responseWithoutBody.statusText,
    _body: res.stringBody,
  };
}

export interface RunUserValidatorResult {
  ok: boolean;
  logs: string[];
  error?: string;
  result?: unknown;
}

export async function runCustomValidation(
  functionBody: string,
  functionArgs: Record<string, unknown>,
  opts?: { memoryMb?: number },
): Promise<RunUserValidatorResult> {
  // Sanity check. This should be handled by the caller already
  // isolated-vm is not 100% safe in a multi-tenant environment, but should be fine when self-hosting
  if (IS_CLOUD) {
    return {
      ok: false,
      error: "Custom validation is not supported in GrowthBook Cloud",
      logs: [],
    };
  }

  const memoryMb = opts?.memoryMb ?? DEFAULT_MEMORY_MB;

  const isolate = new Isolate({
    memoryLimit: memoryMb,
  });

  const logs: string[] = [];

  try {
    const context: Context = await isolate.createContext();
    const jail = context.global;
    await jail.set("global", jail.derefInto());

    // Host -> isolate bridge for fetch
    const fetchRef = new Reference(
      async (url: string, opts: RequestInit = {}) => {
        try {
          const resp = await hostFetch(String(url), opts || {});
          return new ExternalCopy(resp).copyInto();
        } catch (err) {
          return new ExternalCopy({
            __isFetchError: true,
            message: String(err.message || err),
          }).copyInto();
        }
      },
    );

    // Host -> isolate bridge for logging
    const logRef = new Reference((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });

    await jail.set("hostFetch", fetchRef);
    await jail.set("hostLog", logRef);

    // Inject shims for console.log and fetch
    const shimCode = `
      (function() {
        globalThis.console = {
          log: (...args) => hostLog.applyIgnored(undefined, ["[log]", ...args]),
          error: (...args) => hostLog.applyIgnored(undefined, ["[error]", ...args]),
          debug: (...args) => hostLog.applyIgnored(undefined, ["[debug]", ...args])
        };
        globalThis.fetch = async (...args) => {
          const {_body, ...rest} = await hostFetch.applyPromise(undefined, args);
          return {
            ...rest,
            text: async () => _body,
            json: async () => JSON.parse(_body),
          };
        };
      })();
    `;
    await isolate.compileScript(shimCode).then((s) => s.run(context));

    // Wrap user body into a function and make individual arg keys available as variables
    const wrapped = `
      globalThis.__user_validate = async function({${Object.keys(functionArgs).join(", ")}}) {
        ${functionBody}
      };
      "__ready__";
    `;
    await isolate.compileScript(wrapped).then((s) => s.run(context));

    const validateRef = (await jail.get("__user_validate", {
      reference: true,
    })) as Reference;

    if (!validateRef) {
      throw new Error("Unable to get reference to validate function");
    }

    const dataCopy = new ExternalCopy(functionArgs).copyInto();

    // Race between CPU-limited call and wall-clock timeout
    const resultPromise = validateRef.apply(undefined, [dataCopy], {
      arguments: { copy: true },
      result: { copy: true, promise: true },
      timeout: CPU_TIMEOUT_MS, // CPU time budget
    });

    const wallTimeout = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("Validation timed out")),
        WALL_TIMEOUT_MS,
      ),
    );

    const result = await Promise.race([resultPromise, wallTimeout]);

    return { ok: true, result, logs };
  } catch (err) {
    return { ok: false, error: String(err.message || err), logs };
  } finally {
    try {
      isolate.dispose();
    } catch {
      /* ignore */
    }
  }
}

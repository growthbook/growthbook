import { Isolate, Context, Reference, ExternalCopy } from "isolated-vm";
import { RequestInit } from "node-fetch";
import { CustomHookInterface, CustomHookType } from "shared/validators";
import { FeatureInterface } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { cancellableFetch } from "back-end/src/util/http.util";
import { IS_CLOUD } from "back-end/src/util/secrets";
import { ReqContextClass } from "back-end/src/services/context";
import { getContextForAgendaJobByOrgObject } from "back-end/src/services/organizations";

const parseEnvInt = (value: string | undefined, fallback: number) => {
  if (!value) return fallback;
  const n = parseInt(value, 10);
  if (n < 0 || isNaN(n)) return fallback;
  return n;
};

// Default memory limit in MB
const MEMORY_MB = parseEnvInt(process.env.CUSTOM_HOOK_MEMORY_MB, 32);
// Max active CPU time (excluding fetch)
const CPU_TIMEOUT_MS = parseEnvInt(process.env.CUSTOM_HOOK_CPU_TIMEOUT_MS, 100);
// Max total run time (including fetch)
const WALL_TIMEOUT_MS = parseEnvInt(
  process.env.CUSTOM_HOOK_WALL_TIMEOUT_MS,
  5000,
);
// Max response size from fetch calls (default 500KB)
const MAX_FETCH_RESP_SIZE = parseEnvInt(
  process.env.CUSTOM_HOOK_MAX_FETCH_RESP_SIZE,
  500 * 1024,
);

// Export wrapped calls for each hook type
export async function runValidateFeatureHooks({
  context,
  feature,
  original,
}: {
  context: ReqContextClass;
  feature: FeatureInterface;
  original: FeatureInterface | null;
}): Promise<void> {
  return _runCustomHooks(
    context,
    "validateFeature",
    { feature },
    feature.project,
    original ? { feature: original } : undefined,
  );
}

export async function runValidateFeatureRevisionHooks({
  context,
  feature,
  revision,
  original,
}: {
  context: ReqContextClass;
  feature: FeatureInterface;
  revision: FeatureRevisionInterface;
  original: FeatureRevisionInterface;
}): Promise<void> {
  return _runCustomHooks(
    context,
    "validateFeatureRevision",
    { feature, revision },
    feature.project,
    {
      feature,
      revision: original,
    },
  );
}

export interface SandboxEvalResult {
  ok: boolean;
  error?: string;
  returnVal?: unknown;
  log?: string;
}

// Private methods
async function _runCustomHooks(
  context: ReqContextClass,
  hookType: CustomHookType,
  functionArgs: Record<string, unknown>,
  project: string = "",
  originalFunctionArgs?: Record<string, unknown>,
) {
  // Skip on cloud
  // The V8 Isolates approach we are using is too big of a risk in a multi-tenant environment
  // Should be fine for self-hosting though
  if (IS_CLOUD) return;

  // Skip if org doesn't have the premium feature
  if (!context.hasPremiumFeature("custom-hooks")) {
    return;
  }

  // Get an admin version of the context
  // We don't want the user's permissions to affect which hooks are executed
  const adminContext = getContextForAgendaJobByOrgObject(context.org);

  const hooks = await adminContext.models.customHooks.getByHook(
    hookType,
    project,
  );
  for (const hook of hooks) {
    const res = await _runCustomHook(
      adminContext,
      hook,
      functionArgs,
      originalFunctionArgs,
    );
    if (!res.ok) {
      const message =
        (res.error || "Custom hook error") + (res.log ? `\n${res.log}` : "");
      throw new Error(message);
    }
  }
}

async function _runCustomHook(
  context: ReqContextClass,
  hook: CustomHookInterface,
  functionArgs: Record<string, unknown>,
  originalFunctionArgs?: Record<string, unknown>,
) {
  const res = await sandboxEval(hook.code, functionArgs);

  if (res.ok) {
    context.models.customHooks.logSuccess(hook);
  } else {
    context.models.customHooks.logFailure(hook);

    // Try the original args if provided
    if (originalFunctionArgs && hook.incrementalChangesOnly) {
      const originalRes = await sandboxEval(hook.code, originalFunctionArgs);
      if (!originalRes.ok && originalRes.error === res.error) {
        // If it was also failing before this change, then ignore this hook
        return {
          ...res,
          ok: true,
        };
      }
    }
  }

  return res;
}

export async function sandboxEval(
  functionBody: string,
  functionArgs: Record<string, unknown>,
  {
    memoryLimitMB,
    cpuTimeoutMS,
    wallTimeoutMS,
    maxFetchRespSize,
  }: {
    memoryLimitMB?: number;
    cpuTimeoutMS?: number;
    wallTimeoutMS?: number;
    maxFetchRespSize?: number;
  } = {},
): Promise<SandboxEvalResult> {
  // Sanity check. This should be handled by the caller already
  // isolated-vm is not 100% safe in a multi-tenant environment, but should be fine when self-hosting
  if (IS_CLOUD) {
    return {
      ok: false,
      error: "Custom hooks are not supported in GrowthBook Cloud",
    };
  }

  const isolate = new Isolate({
    memoryLimit: memoryLimitMB ?? MEMORY_MB,
  });

  const logs: string[] = [];

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

    // Host -> isolate bridge for logging
    const logRef = new Reference((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });

    await jail.set("hostFetch", fetchRef);
    await jail.set("hostLog", logRef);

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

    // Race between CPU-limited call and wall-clock timeout
    const resultPromise = funcRef.apply(undefined, [dataCopy], {
      arguments: { copy: true },
      result: { copy: true, promise: true },
      timeout: cpuTimeoutMS ?? CPU_TIMEOUT_MS,
    });

    const wallTimeout = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("Execution timed out")),
        wallTimeoutMS ?? WALL_TIMEOUT_MS,
      ),
    );

    const returnVal = await Promise.race([resultPromise, wallTimeout]);
    return { ok: true, returnVal, log: logs.join("\n") };
  } catch (err) {
    const message = err.message || err || "";
    return {
      ok: false,
      error: message ? `Custom hook: ${message}` : "Custom hook error",
      log: logs.join("\n"),
    };
  } finally {
    try {
      isolate.dispose();
    } catch {
      /* ignore */
    }
  }
}

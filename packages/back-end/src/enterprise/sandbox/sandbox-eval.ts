// sandbox-runner.ts
import { Isolate, Context, Reference, ExternalCopy } from "isolated-vm";
import { RequestInit } from "node-fetch";
import { cancellableFetch } from "back-end/src/util/http.util";
import { IS_CLOUD } from "back-end/src/util/secrets";
import {
  CustomHookInterface,
  CustomHookType,
} from "back-end/src/routers/custom-hooks/custom-hooks.validators";
import { FeatureInterface } from "back-end/types/feature";
import { ReqContextClass } from "back-end/src/services/context";
import { getContextForAgendaJobByOrgObject } from "back-end/src/services/organizations";

const MEMORY_MB = 32;
const CPU_TIMEOUT_MS = 100; // max active CPU time (excluding fetch)
const WALL_TIMEOUT_MS = 5000; // max total run time (including fetch)
const MAX_FETCH_RESP_SIZE = 500 * 1024; // 500KB max response size from fetch calls

// Export wrapped calls for each hook type
export async function runValidateFeatureHooks(
  context: ReqContextClass,
  feature: FeatureInterface,
): Promise<void> {
  return _runCustomHooks(
    context,
    "validateFeature",
    { feature },
    feature.project,
  );
}

interface SandboxEvalResult {
  ok: boolean;
  error?: string;
  result?: unknown;
}

// Private methods
async function _runCustomHooks(
  context: ReqContextClass,
  hookType: CustomHookType,
  functionArgs: Record<string, unknown>,
  project: string = "",
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
    const res = await _runCustomHook(adminContext, hook, functionArgs);
    if (!res.ok) {
      throw new Error(res.error || "Custom hook error");
    }
  }
}

async function _runCustomHook(
  context: ReqContextClass,
  hook: CustomHookInterface,
  functionArgs: Record<string, unknown>,
) {
  const res = await sandboxEval(hook.code, functionArgs);

  if (res.ok) {
    context.models.customHooks.logSuccess(hook);
  } else {
    context.models.customHooks.logFailure(hook);
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
        globalThis.console = {
          log: (...args) => hostLog.applyIgnored(undefined, ["[log]", ...args]),
          error: (...args) => hostLog.applyIgnored(undefined, ["[error]", ...args]),
          debug: (...args) => hostLog.applyIgnored(undefined, ["[debug]", ...args])
        };
        globalThis.fetch = async (...args) => {
          const { _body, _error, ...rest } = await hostFetch.applyPromise(undefined, args);
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
      throw new Error("Failed to compile custom hook");
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
        () => reject(new Error("Custom hook timed out")),
        wallTimeoutMS ?? WALL_TIMEOUT_MS,
      ),
    );

    const result = await Promise.race([resultPromise, wallTimeout]);
    return { ok: true, result };
  } catch (err) {
    const message = err.message || err || "Custom hook error";
    return { ok: false, error: message + logs.map((l) => `\n  ${l}`).join("") };
  } finally {
    try {
      isolate.dispose();
    } catch {
      /* ignore */
    }
  }
}

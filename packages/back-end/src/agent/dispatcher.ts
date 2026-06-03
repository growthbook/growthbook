import type { NextFunction } from "express";
import type { ReqContext } from "back-end/types/request";
import type { OpenApiRoute } from "back-end/src/util/handler";
import { allRoutes } from "back-end/src/api/api.router";
import { logger } from "back-end/src/util/logger";

/**
 * In-process dispatcher for the public REST API surface.
 *
 * Lets internal callers (e.g. the generic AI agent) invoke any registered
 * `/api/v1/*` (or `/api/v2/*`) endpoint without going over HTTP. The same
 * Express handler that serves real customer requests runs here, so the
 * request shape, validation, response shape, and error format all match
 * what an external agent calling the REST API would see.
 *
 * What this skips compared to a real HTTP request:
 *  - `authenticateApiRequestMiddleware` (the caller already has a context)
 *  - body parsing, rate limit, CORS
 *  - any per-route `middleware` array attached to the route descriptor —
 *    this is a deliberate trade-off: the auth/rate-limit middlewares are
 *    moot in-process; route-specific middlewares are uncommon for our API.
 */

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type DispatchInput = {
  method: HttpMethod;
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
};

export type DispatchResult = {
  status: number;
  body: unknown;
};

export type DispatchHooks = {
  /**
   * Fires once for every successful (2xx) dispatch result. Throwing here
   * never breaks dispatch — errors are logged and swallowed.
   */
  onSuccess?: (input: DispatchInput, result: DispatchResult) => void;
};

type CompiledRoute = {
  method: string;
  fullPath: string;
  re: RegExp;
  paramNames: string[];
  route: OpenApiRoute;
};

let compiled: CompiledRoute[] | null = null;
let routesOverride: OpenApiRoute[] | null = null;

function compileRoutes(): CompiledRoute[] {
  if (compiled) return compiled;
  const source = routesOverride ?? allRoutes;
  compiled = source
    .filter((r) => !!r.method)
    .map((r) => {
      const version = (r as { version?: string }).version ?? "v1";
      // Mirror what an external HTTP caller would curl: the Express router
      // is mounted at /api in app.ts, so the public URL is /api/<version>/...
      // We bake that prefix in here so internal dispatch uses the exact same
      // path string a customer would.
      const fullPath = `/api/${version}${r.path}`;
      const paramNames: string[] = [];
      const reSource = fullPath
        .split("/")
        .map((seg) => {
          if (!seg) return "";
          if (seg.startsWith(":")) {
            paramNames.push(seg.slice(1));
            return "([^/]+)";
          }
          return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        })
        .join("/");
      return {
        method: (r.method as string).toUpperCase(),
        fullPath,
        re: new RegExp(`^${reSource}$`),
        paramNames,
        route: r,
      };
    });
  return compiled;
}

/**
 * Normalize an input path to the canonical form used by `compileRoutes`
 * (`/api/v1/...`). Strips a query string if present and accepts a few
 * forgiving shapes:
 *   - `/api/v1/foo`  → unchanged
 *   - `/v1/foo`      → `/api/v1/foo`
 *   - `/foo`         → `/api/v1/foo`  (assumes v1)
 */
export function normalizePath(rawPath: string): string {
  const noQuery = rawPath.split("?")[0];
  if (noQuery.startsWith("/api/")) return noQuery;
  if (/^\/v\d+\//.test(noQuery)) return `/api${noQuery}`;
  if (noQuery.startsWith("/")) return `/api/v1${noQuery}`;
  return noQuery;
}

function matchRoute(
  method: string,
  path: string,
): { route: OpenApiRoute; params: Record<string, string> } | null {
  const m = method.toUpperCase();
  const cleanPath = normalizePath(path);
  for (const c of compileRoutes()) {
    if (c.method !== m) continue;
    const match = c.re.exec(cleanPath);
    if (match) {
      const params: Record<string, string> = {};
      c.paramNames.forEach((name, i) => {
        params[name] = decodeURIComponent(match[i + 1] ?? "");
      });
      return { route: c.route, params };
    }
  }
  return null;
}

/**
 * Build a minimal Express-shaped request that satisfies the fields our API
 * handlers actually read: `method`, `path`, `params`, `query`, `body`,
 * `context`, `user`, `organization`, `apiKey`, `audit`, `eventAudit`,
 * plus a `get(name)` header lookup.
 */
function buildFakeReq(
  ctx: ReqContext,
  input: DispatchInput,
  params: Record<string, string>,
): Record<string, unknown> {
  const headers: Record<string, string> = {};

  return {
    method: input.method,
    path: input.path,
    url: input.path,
    originalUrl: input.path,
    baseUrl: "",
    params,
    query: input.query ?? {},
    body: input.body ?? {},
    headers,
    context: ctx,
    user: ctx.userId
      ? {
          id: ctx.userId,
          email: ctx.email ?? "",
          name: ctx.userName ?? "",
        }
      : undefined,
    organization: ctx.org,
    apiKey: ctx.apiKey ?? "internal-agent",
    eventAudit: ctx.auditUser,
    audit: async (data: Parameters<ReqContext["auditLog"]>[0]) => {
      await ctx.auditLog(data);
    },
    get(name: string) {
      return headers[String(name).toLowerCase()];
    },
  };
}

function buildFakeRes(): {
  res: Record<string, unknown>;
  capture: () => { status: number; body: unknown; ended: boolean };
} {
  let status = 200;
  let body: unknown = undefined;
  let ended = false;
  const headers: Record<string, string> = {};

  const res: Record<string, unknown> = {
    headersSent: false,
    locals: {},
    status(s: number) {
      status = s;
      return res;
    },
    json(b: unknown) {
      body = b;
      ended = true;
      return res;
    },
    send(b: unknown) {
      body = b;
      ended = true;
      return res;
    },
    end() {
      ended = true;
      return res;
    },
    setHeader(name: string, value: string | number) {
      headers[String(name).toLowerCase()] = String(value);
      return res;
    },
    getHeader(name: string) {
      return headers[String(name).toLowerCase()];
    },
    removeHeader(name: string) {
      delete headers[String(name).toLowerCase()];
      return res;
    },
  };

  return {
    res,
    capture: () => ({ status, body, ended }),
  };
}

export async function dispatchInternal(
  ctx: ReqContext,
  input: DispatchInput,
  hooks?: DispatchHooks,
): Promise<DispatchResult> {
  if (!input.path || !input.path.startsWith("/")) {
    return {
      status: 400,
      body: {
        message: `Invalid path "${input.path}". Path must start with "/".`,
      },
    };
  }

  const matched = matchRoute(input.method, input.path);
  if (!matched) {
    return {
      status: 404,
      body: {
        message: `Unknown endpoint: ${input.method} ${input.path}`,
      },
    };
  }

  const { route, params } = matched;

  const fakeReq = buildFakeReq(ctx, input, params);
  const { res: fakeRes, capture } = buildFakeRes();

  let nextErr: unknown = undefined;
  const fakeNext: NextFunction = (err?: unknown) => {
    if (err) nextErr = err;
  };

  try {
    await Promise.resolve(
      (
        route.handler as unknown as (
          req: unknown,
          res: unknown,
          next: NextFunction,
        ) => unknown
      )(fakeReq, fakeRes, fakeNext),
    );
  } catch (err) {
    nextErr = err;
  }

  if (nextErr) {
    const message =
      nextErr instanceof Error ? nextErr.message : "Internal server error";
    return { status: 500, body: { message } };
  }

  const { status, body, ended } = capture();
  if (!ended) {
    return {
      status: 500,
      body: { message: "Handler did not send a response" },
    };
  }

  const result: DispatchResult = { status, body };

  if (status >= 200 && status < 300) {
    try {
      hooks?.onSuccess?.(input, result);
    } catch (err) {
      logger.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "dispatchInternal onSuccess hook threw",
      );
    }
  }

  return result;
}

/**
 * Test-only escape hatch — lets unit tests inject a custom route table
 * and reset the compiled cache between cases.
 */
export function _setRoutesForTests(routes: OpenApiRoute[] | null): void {
  routesOverride = routes;
  compiled = null;
}

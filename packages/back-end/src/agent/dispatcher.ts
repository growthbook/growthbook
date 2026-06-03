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
 *  - any per-route `middleware` array attached to the route descriptor, plus
 *    the `deprecationDate` response-header middleware injected in
 *    `api.router.ts`. Today only `getSdkPayload`'s preflight middleware is
 *    affected; the auth/rate-limit middlewares are moot in-process.
 *
 * Known fidelity gaps an external HTTP caller would not have:
 *  - `query`/`params` are forwarded as-is. Over real HTTP these are always
 *    strings (or string[]); here a caller can pass numbers/booleans/objects,
 *    so Zod validation may behave differently from a real request. Callers
 *    should send query values as strings to match the public API.
 *
 * Security model: dispatch runs every handler with the caller's own context,
 * so authorization is identical to a real request from that caller. Handlers
 * gate writes through `req.context.permissions` (the caller's role-scoped
 * `Permissions` instance) and the `checkPermissions` shim delegates to the
 * same role check, so this CANNOT let a caller do anything their org role
 * doesn't already allow — there is no privilege elevation. What it *does* do
 * is expose the entire REST surface in one place with no per-endpoint
 * allowlist, so any higher-level gating (mutation confirmation, read-only
 * exploration allowlist) must live upstream of this function (see
 * `general-agent.ts`). Never expose dispatch without that gate.
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

class MalformedPathError extends Error {}

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
        const raw = match[i + 1] ?? "";
        try {
          // Mirror Express: path params are percent-decoded. Malformed
          // encoding (e.g. a stray "%") makes decodeURIComponent throw —
          // surface it as a 400 rather than an uncaught rejection.
          params[name] = decodeURIComponent(raw);
        } catch {
          throw new MalformedPathError(
            `Malformed path parameter "${name}": ${raw}`,
          );
        }
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
 * `checkPermissions`, plus a `get(name)` header lookup.
 *
 * Authorization note: every field that gates access is derived from the
 * caller's `ctx`, so a handler can only do what the caller's org role allows.
 * `req.context.permissions` (the path all `/api/*` handlers use today) is the
 * caller's role-scoped `Permissions` instance, and `checkPermissions` (the
 * legacy `ApiRequestLocals` gate, unused by current `/api/*` handlers but part
 * of the contract) delegates to the same role check. There is no privilege
 * elevation here: dispatch is exactly as capable as the caller's role.
 */
function buildFakeReq(
  ctx: ReqContext,
  input: DispatchInput,
  params: Record<string, string>,
): Record<string, unknown> {
  const headers: Record<string, string> = {};

  // Use the canonical `/api/v1/...` form (matching what the router resolved)
  // so any handler reading `req.path`/`req.originalUrl` sees the same value a
  // real request would, regardless of the prefix shape the caller sent.
  const canonicalPath = normalizePath(input.path);

  return {
    method: input.method,
    path: canonicalPath,
    url: canonicalPath,
    originalUrl: canonicalPath,
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
          // Carry the caller's super-admin flag so super-admin-gated handlers
          // make the same allow/deny decision they would for a real request.
          superAdmin: ctx.superAdmin,
        }
      : undefined,
    organization: ctx.org,
    apiKey: ctx.apiKey ?? "internal-agent",
    eventAudit: ctx.auditUser,
    audit: async (data: Parameters<ReqContext["auditLog"]>[0]) => {
      await ctx.auditLog(data);
    },
    // Faithful implementation of the `ApiRequestLocals` permission gate.
    // Delegates to the caller's role-scoped permissions and throws the same
    // error the real session/API-key middleware throws on denial — so a
    // handler that relies on this (none in `/api/*` do today) still enforces
    // the caller's role rather than silently passing or crashing.
    checkPermissions: (
      permission: Parameters<ReqContext["requirePermission"]>[0],
      project?: Parameters<ReqContext["requirePermission"]>[1],
      envs?: Parameters<ReqContext["requirePermission"]>[2],
    ) => {
      ctx.requirePermission(permission, project, envs);
    },
    get(name: string) {
      return headers[String(name).toLowerCase()];
    },
  };
}

/**
 * Mirror what Express `res.json` puts on the wire: the body is run through
 * `JSON.stringify`/`JSON.parse`, so `Date` becomes an ISO string, `undefined`
 * fields are dropped, Mongoose documents collapse to plain objects, etc. An
 * external caller never sees the in-memory object, and neither should the
 * agent. A non-serializable body (e.g. a circular structure) throws here, the
 * same way it would for a real HTTP response.
 */
function toJsonWire(b: unknown): unknown {
  if (b === undefined) return undefined;
  return JSON.parse(JSON.stringify(b));
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
      body = toJsonWire(b);
      ended = true;
      return res;
    },
    send(b: unknown) {
      // `res.send` serializes objects/arrays as JSON too; strings/buffers are
      // sent verbatim. Only round-trip non-string bodies to match that.
      body = typeof b === "string" ? b : toJsonWire(b);
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

  let matched: ReturnType<typeof matchRoute>;
  try {
    matched = matchRoute(input.method, input.path);
  } catch (err) {
    if (err instanceof MalformedPathError) {
      return { status: 400, body: { message: err.message } };
    }
    throw err;
  }
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
    // Errors that escape to here come from layers outside the wrapped handler
    // (its inner catch already maps thrown errors to `e.status || 400`). Honor
    // a `status`/`conflicts` carried on the error so the response still matches
    // the public `ApiErrorResponse` contract; default to 500 for anything
    // genuinely unexpected.
    const e = nextErr as {
      message?: unknown;
      status?: unknown;
      conflicts?: unknown;
    };
    const message =
      nextErr instanceof Error ? nextErr.message : "Internal server error";
    const status = typeof e.status === "number" ? e.status : 500;
    const body: Record<string, unknown> = { message };
    if (e.conflicts !== undefined) body.conflicts = e.conflicts;
    return { status, body };
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

import type { ReqContext } from "back-end/types/request";
import type { ApiRequestLocals } from "back-end/types/api";
import { type OpenApiRoute, runApiHandler } from "back-end/src/util/handler";
import { allRoutes } from "back-end/src/api/api.router";
import { logger } from "back-end/src/util/logger";

/**
 * In-process dispatcher for the public REST API surface. Lets internal callers
 * (e.g. the generic AI agent) invoke any registered `/api/v1/*` (or `/api/v2/*`)
 * endpoint without going over HTTP, reusing the same `runApiHandler` helper as
 * the Express wrapper so validation, response shape, and errors match the real
 * REST API.
 *
 * Skipped vs. a real request: auth/rate-limit/CORS/body-parsing middleware and
 * per-route `middleware` arrays (only `getSdkPayload`'s preflight matters here).
 *
 * Fidelity gap: `query`/`params` are forwarded as-is, so callers should send
 * query values as strings to match how Zod validates real HTTP requests.
 *
 * Security: every handler runs with the caller's own context, so authorization
 * is identical to a real request — no privilege elevation. But this exposes the
 * entire REST surface with no per-endpoint allowlist, so higher-level gating
 * (mutation confirmation, read-only allowlist) must live upstream (see
 * `general-agent.ts`). Never expose dispatch without that gate.
 *
 * File layout (top-down): the public `dispatchInternal` entry point and its
 * phase helpers come first, followed by the lower-level "build the request",
 * "match a route", and test-only helpers it depends on.
 */

// =============================================================================
// Public types
// =============================================================================

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
  /** Fires on every 2xx dispatch. Throwing here is logged and swallowed. */
  onSuccess?: (input: DispatchInput, result: DispatchResult) => void;
};

// =============================================================================
// Dispatch
//
// The public entry point and the three phases it runs: resolve the route,
// execute the handler, fire the success hook. Each phase is its own helper so
// `dispatchInternal` reads as a short pipeline.
// =============================================================================

export async function dispatchInternal(
  ctx: ReqContext,
  input: DispatchInput,
  hooks?: DispatchHooks,
): Promise<DispatchResult> {
  const resolved = resolveRoute(input);
  if (!resolved.ok) return resolved.result;

  const result = await executeRoute(
    ctx,
    input,
    resolved.route,
    resolved.params,
  );

  if (result.status >= 200 && result.status < 300) {
    fireSuccessHook(input, result, hooks);
  }

  return result;
}

/**
 * Resolve an input to its matching route + path params, or to the error
 * `DispatchResult` an external caller would get: 400 for a malformed path,
 * 404 for an unknown endpoint.
 */
type RouteResolution =
  | { ok: true; route: OpenApiRoute; params: Record<string, string> }
  | { ok: false; result: DispatchResult };

function resolveRoute(input: DispatchInput): RouteResolution {
  if (!input.path || !input.path.startsWith("/")) {
    return {
      ok: false,
      result: {
        status: 400,
        body: {
          message: `Invalid path "${input.path}". Path must start with "/".`,
        },
      },
    };
  }

  let matched: ReturnType<typeof matchRoute>;
  try {
    matched = matchRoute(input.method, input.path);
  } catch (err) {
    if (err instanceof MalformedPathError) {
      return {
        ok: false,
        result: { status: 400, body: { message: err.message } },
      };
    }
    throw err;
  }
  if (!matched) {
    return {
      ok: false,
      result: {
        status: 404,
        body: { message: `Unknown endpoint: ${input.method} ${input.path}` },
      },
    };
  }

  return { ok: true, route: matched.route, params: matched.params };
}

/**
 * Build the request, run the matched route through the shared `runApiHandler`,
 * and JSON-round-trip the body for on-the-wire fidelity. Translates an
 * unexpected throw into an error `DispatchResult` rather than propagating it.
 */
async function executeRoute(
  ctx: ReqContext,
  input: DispatchInput,
  route: OpenApiRoute,
  params: Record<string, string>,
): Promise<DispatchResult> {
  const fakeReq = buildFakeReq(ctx, input, params);
  try {
    // Same helper the Express wrapper uses: validates params/query/body, runs
    // the route's `rawHandler`, and maps success/errors to {status, body}.
    const { status, body } = await runApiHandler(
      fakeReq as { params: unknown; query: unknown; body: unknown },
      route.schemas,
      route.rawHandler,
    );
    return { status, body: toJsonWire(body) };
  } catch (err) {
    return unexpectedErrorResult(err);
  }
}

/**
 * Map an error thrown *outside* `runApiHandler` to a `DispatchResult`.
 * `runApiHandler` already shapes handler errors into the public contract, so
 * anything reaching here is unexpected (e.g. a non-serializable body in
 * `toJsonWire`). Honor any `status`/`conflicts` carried on the error; else 500.
 */
function unexpectedErrorResult(err: unknown): DispatchResult {
  const e = err as { status?: unknown; conflicts?: unknown };
  const message = err instanceof Error ? err.message : "Internal server error";
  const status = typeof e.status === "number" ? e.status : 500;
  const body: Record<string, unknown> = { message };
  if (e.conflicts !== undefined) body.conflicts = e.conflicts;
  return { status, body };
}

/** Fire the 2xx success hook, logging (never rethrowing) if it throws. */
function fireSuccessHook(
  input: DispatchInput,
  result: DispatchResult,
  hooks?: DispatchHooks,
): void {
  try {
    hooks?.onSuccess?.(input, result);
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "dispatchInternal onSuccess hook threw",
    );
  }
}

// =============================================================================
// Request & response shaping
// =============================================================================

/**
 * The subset of an Express API request that `buildFakeReq` populates and our
 * handlers/middleware actually read. The auth/permission fields are `Pick`ed
 * from `ApiRequestLocals` so they stay tied to the canonical type — if that
 * contract changes, `buildFakeReq` breaks loudly. The HTTP fields are declared
 * here with the simple shapes we build, rather than `Pick`ed from Express's
 * `Request`, whose `params`/`query`/`body` are generic, whose `get` is an
 * overloaded signature, and whose `headers` is the wider `IncomingHttpHeaders`.
 */
type FakeApiRequest = Pick<
  ApiRequestLocals,
  | "apiKey"
  | "organization"
  | "eventAudit"
  | "audit"
  | "context"
  | "checkPermissions"
> & {
  // `ctx` only carries these four user fields, so we build a partial user rather
  // than a full `UserInterface`. Derived from the canonical type (not redeclared)
  // so it stays in sync, but narrowed to exactly what we populate.
  user?: Pick<
    NonNullable<ApiRequestLocals["user"]>,
    "id" | "email" | "name" | "superAdmin"
  >;
  method: string;
  path: string;
  url: string;
  originalUrl: string;
  baseUrl: string;
  params: Record<string, string>;
  query: unknown;
  body: unknown;
  headers: Record<string, string>;
  get(name: string): string | undefined;
};

/**
 * Build a minimal Express-shaped request with the fields our API handlers read.
 * Every access-gating field derives from the caller's `ctx`, so a handler can
 * only do what the caller's org role allows — no privilege elevation.
 */
function buildFakeReq(
  ctx: ReqContext,
  input: DispatchInput,
  params: Record<string, string>,
): FakeApiRequest {
  const headers: Record<string, string> = {};

  // Canonical `/api/v1/...` form so handlers reading `req.path`/`req.originalUrl`
  // see the same value a real request would, regardless of the caller's prefix.
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
          // Carry the super-admin flag so super-admin-gated handlers decide as
          // they would for a real request.
          superAdmin: ctx.superAdmin,
        }
      : undefined,
    organization: ctx.org,
    apiKey: ctx.apiKey ?? "internal-agent",
    eventAudit: ctx.auditUser,
    audit: async (data: Parameters<ReqContext["auditLog"]>[0]) => {
      await ctx.auditLog(data);
    },
    // The `ApiRequestLocals` permission gate: delegates to the caller's
    // role-scoped permissions and throws the same denial error the real
    // middleware would.
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
 * Mirror what Express `res.json` puts on the wire by round-tripping through
 * JSON (Date→ISO, drop undefined, Mongoose docs→plain objects). A
 * non-serializable body throws here, just as it would for a real response.
 */
function toJsonWire(b: unknown): unknown {
  if (b === undefined) return undefined;
  return JSON.parse(JSON.stringify(b));
}

// =============================================================================
// Route matching
//
// A route's path template (e.g. `/features/:id`) is compiled once into a
// named-capture regex and cached. `matchRoute` walks the compiled table to
// find the route + path params for an incoming method/path. All of this is the
// "find the handler" concern, kept separate from the "run the handler" concern
// in `dispatchInternal` above.
// =============================================================================

type CompiledRoute = {
  method: string;
  fullPath: string;
  re: RegExp;
  route: OpenApiRoute;
};

let compiled: CompiledRoute[] | null = null;
let routesOverride: OpenApiRoute[] | null = null;

class MalformedPathError extends Error {}

/**
 * The public URL for a route. The router is mounted at `/api`, so a route's
 * declared `path` becomes `/api/<version><path>` (version defaults to v1).
 */
function routeFullPath(route: OpenApiRoute): string {
  const version = (route as { version?: string }).version ?? "v1";
  return `/api/${version}${route.path}`;
}

/**
 * Compile a path template into an anchored, named-capture regex. Each `:param`
 * segment becomes `(?<param>[^/]+)`; every other segment is escaped literally.
 * `matchRoute` reads `match.groups`, so params bind by name, not position.
 */
function pathTemplateToRegExp(fullPath: string): RegExp {
  const source = fullPath
    .split("/")
    .map((seg) => {
      if (!seg) return "";
      if (seg.startsWith(":")) return `(?<${seg.slice(1)}>[^/]+)`;
      return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");
  return new RegExp(`^${source}$`);
}

/** Compile (and cache) the active route table into matchable regexes. */
function compileRoutes(): CompiledRoute[] {
  if (compiled) return compiled;
  const source = routesOverride ?? allRoutes;
  compiled = source
    .filter((r) => !!r.method && !r.deprecated)
    .map((r) => {
      const fullPath = routeFullPath(r);
      return {
        method: (r.method as string).toUpperCase(),
        fullPath,
        re: pathTemplateToRegExp(fullPath),
        route: r,
      };
    });
  return compiled;
}

/**
 * Normalize a path to the canonical `/api/v1/...` form, stripping any query
 * string. Accepts `/api/v1/foo` (unchanged), `/v1/foo`, and `/foo` (assumes v1).
 */
export function normalizePath(rawPath: string): string {
  const noQuery = rawPath.split("?")[0];
  if (noQuery.startsWith("/api/")) return noQuery;
  if (/^\/v\d+\//.test(noQuery)) return `/api${noQuery}`;
  if (noQuery.startsWith("/")) return `/api/v1${noQuery}`;
  return noQuery;
}

/**
 * Percent-decode the regex's named capture groups into a path-params map,
 * mirroring Express. Malformed encoding makes `decodeURIComponent` throw; we
 * raise `MalformedPathError` so the caller can map it to a 400 rather than
 * letting an uncaught rejection escape.
 */
function decodePathParams(
  groups: Record<string, string | undefined> | undefined,
): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [name, raw] of Object.entries(groups ?? {})) {
    try {
      params[name] = decodeURIComponent(raw ?? "");
    } catch {
      throw new MalformedPathError(
        `Malformed path parameter "${name}": ${raw}`,
      );
    }
  }
  return params;
}

/**
 * Find the route whose method + path template matches the incoming request,
 * returning it alongside the decoded path params. Returns `null` when nothing
 * matches (the caller turns that into a 404).
 */
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
      return { route: c.route, params: decodePathParams(match.groups) };
    }
  }
  return null;
}

// =============================================================================
// Test helpers
// =============================================================================

/** Test-only: inject a custom route table and reset the compiled cache. */
export function _setRoutesForTests(routes: OpenApiRoute[] | null): void {
  routesOverride = routes;
  compiled = null;
}

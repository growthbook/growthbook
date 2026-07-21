import type { ZodType } from "zod";
import { z } from "zod";
import type { ReqContext } from "back-end/types/request";
import type { OpenApiRoute } from "back-end/src/util/handler";
import { MergeConflictError } from "back-end/src/util/errors";

// Short-circuit the import chain — dispatcher.ts imports allRoutes from
// api.router, which pulls in the entire app (mongoose, integrations, etc.)
// and is unsuitable for a unit test. The test relies on _setRoutesForTests
// to inject routes anyway.
jest.mock("back-end/src/api/api.router", () => ({
  allRoutes: [],
}));

import {
  dispatchInternal,
  _setRoutesForTests,
} from "back-end/src/agent/dispatcher";

// Minimal context stub — handlers in this test only read `req.context` if
// they need anything; the routes here keep it simple.
function makeCtx(overrides: Partial<ReqContext> = {}): ReqContext {
  const audited: unknown[] = [];
  return {
    userId: "u_test",
    email: "test@example.com",
    userName: "Test",
    superAdmin: false,
    apiKey: undefined,
    auditUser: { type: "dashboard", id: "u_test", email: "test@example.com" },
    org: { id: "org_test" },
    auditLog: async (data: unknown) => {
      audited.push(data);
    },
    // Default to allow; individual tests override to assert denial behavior.
    requirePermission: () => {},
    ...overrides,
    // Satisfy the rest of ReqContext via cast — handlers in these tests
    // don't touch the rest.
  } as unknown as ReqContext;
}

// The request shape the dispatcher hands to a route's rawHandler. Only the
// fields the tests actually read are spelled out.
type FakeReq = {
  params: Record<string, string>;
  query: Record<string, unknown>;
  body: unknown;
  path: string;
  context: { org: { id: string } };
  user?: { superAdmin?: boolean };
  checkPermissions: (permission: string, project?: unknown) => void;
};

// Factory for OpenApiRoute fixtures. Routes now expose `rawHandler` — the
// unwrapped `(req) => Promise<result>` business handler the dispatcher drives
// through `runApiHandler` (exactly what `allRoutes` contains in production).
function makeRoute(
  method: "get" | "post" | "put" | "patch" | "delete",
  path: string,
  rawHandler: (req: FakeReq) => unknown | Promise<unknown>,
  schemas: { params?: ZodType; body?: ZodType; query?: ZodType } = {},
): OpenApiRoute {
  return {
    method,
    path,
    operationId: `op_${method}_${path}`,
    schemas,
    rawHandler,
  } as unknown as OpenApiRoute;
}

afterEach(() => {
  _setRoutesForTests(null);
});

describe("dispatchInternal", () => {
  it("returns 200 with body for a matching GET", async () => {
    _setRoutesForTests([
      makeRoute("get", "/feature-keys", () => ({ keys: ["a", "b"] })),
    ]);

    const result = await dispatchInternal(makeCtx(), {
      method: "GET",
      path: "/v1/feature-keys",
    });

    expect(result).toEqual({ status: 200, body: { keys: ["a", "b"] } });
  });

  it("returns 404 for an unknown path", async () => {
    _setRoutesForTests([]);

    const result = await dispatchInternal(makeCtx(), {
      method: "GET",
      path: "/v1/does-not-exist",
    });

    expect(result.status).toBe(404);
    expect(result.body).toEqual({
      message: expect.stringContaining("Unknown endpoint"),
    });
  });

  it("returns 404 for a known path with the wrong method", async () => {
    _setRoutesForTests([makeRoute("get", "/features", () => ({}))]);

    const result = await dispatchInternal(makeCtx(), {
      method: "POST",
      path: "/v1/features",
    });

    expect(result.status).toBe(404);
  });

  it("extracts path params and forwards them to the handler", async () => {
    let receivedParams: Record<string, string> | undefined;
    _setRoutesForTests([
      makeRoute("get", "/features/:id", (req) => {
        receivedParams = req.params;
        return { id: req.params.id };
      }),
    ]);

    const result = await dispatchInternal(makeCtx(), {
      method: "GET",
      path: "/v1/features/feat_abc",
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ id: "feat_abc" });
    expect(receivedParams).toEqual({ id: "feat_abc" });
  });

  it("forwards query and body to the handler", async () => {
    let received: { query: unknown; body: unknown } | undefined;
    _setRoutesForTests([
      makeRoute("post", "/things", (req) => {
        received = { query: req.query, body: req.body };
        return { ok: true };
      }),
    ]);

    const result = await dispatchInternal(makeCtx(), {
      method: "POST",
      path: "/v1/things",
      query: { sort: "name" },
      body: { name: "x", count: 3 },
    });

    expect(result).toEqual({ status: 200, body: { ok: true } });
    expect(received).toEqual({
      query: { sort: "name" },
      body: { name: "x", count: 3 },
    });
  });

  it("translates a thrown handler error into a 400 (matching the REST wrapper)", async () => {
    _setRoutesForTests([
      makeRoute("get", "/boom", () => {
        throw new Error("kaboom");
      }),
    ]);

    const result = await dispatchInternal(makeCtx(), {
      method: "GET",
      path: "/v1/boom",
    });

    expect(result.status).toBe(400);
    expect(result.body).toEqual({ message: "kaboom" });
  });

  it("honors an explicit err.status thrown by the handler", async () => {
    _setRoutesForTests([
      makeRoute("get", "/forbidden", () => {
        throw Object.assign(new Error("nope"), { status: 403 });
      }),
    ]);

    const result = await dispatchInternal(makeCtx(), {
      method: "GET",
      path: "/v1/forbidden",
    });

    expect(result).toEqual({ status: 403, body: { message: "nope" } });
  });

  it("validates request body against the route schema and returns 400", async () => {
    _setRoutesForTests([
      makeRoute("post", "/validate", () => ({ ok: true }), {
        body: z.object({ name: z.string() }).strict(),
      }),
    ]);

    const result = await dispatchInternal(makeCtx(), {
      method: "POST",
      path: "/v1/validate",
      body: { notName: 1 },
    });

    expect(result.status).toBe(400);
    expect(result.body).toEqual({
      message: expect.stringContaining("Request body:"),
    });
  });

  it("writes Zod-coerced values back onto the request before the handler runs", async () => {
    let seenCount: unknown;
    _setRoutesForTests([
      makeRoute(
        "get",
        "/coerce",
        (req) => {
          seenCount = (req.query as { count: unknown }).count;
          return { ok: true };
        },
        { query: z.object({ count: z.coerce.number() }) },
      ),
    ]);

    const result = await dispatchInternal(makeCtx(), {
      method: "GET",
      path: "/v1/coerce",
      query: { count: "3" },
    });

    expect(result.status).toBe(200);
    expect(seenCount).toBe(3);
  });

  it("preserves a MergeConflictError's status and conflicts", async () => {
    _setRoutesForTests([
      makeRoute("post", "/conflict", () => {
        throw new MergeConflictError("revision is stale", [{ field: "base" }]);
      }),
    ]);

    const result = await dispatchInternal(makeCtx(), {
      method: "POST",
      path: "/v1/conflict",
    });

    expect(result.status).toBe(409);
    expect(result.body).toEqual({
      message: "revision is stale",
      code: "conflict",
      details: { conflicts: [{ field: "base" }] },
      conflicts: [{ field: "base" }],
    });
  });

  it("invokes onSuccess hook for 2xx and skips it for non-2xx", async () => {
    _setRoutesForTests([
      makeRoute("get", "/good", () => ({ a: 1 })),
      makeRoute("get", "/bad", () => {
        throw Object.assign(new Error("no"), { status: 400 });
      }),
    ]);

    const calls: Array<{ status: number; body: unknown }> = [];
    const hooks = {
      onSuccess: (
        _input: { method: string; path: string },
        result: { status: number; body: unknown },
      ) => {
        calls.push(result);
      },
    };

    await dispatchInternal(
      makeCtx(),
      { method: "GET", path: "/v1/good" },
      hooks,
    );
    await dispatchInternal(
      makeCtx(),
      { method: "GET", path: "/v1/bad" },
      hooks,
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ status: 200, body: { a: 1 } });
  });

  it("populates req.context with the caller's ctx so handlers can use req.context.*", async () => {
    let seenOrgId: string | undefined;
    _setRoutesForTests([
      makeRoute("get", "/whoami", (req) => {
        seenOrgId = req.context.org.id;
        return { org: seenOrgId };
      }),
    ]);

    const result = await dispatchInternal(makeCtx(), {
      method: "GET",
      path: "/v1/whoami",
    });

    expect(result.status).toBe(200);
    expect(seenOrgId).toBe("org_test");
  });

  it("rejects an empty or non-leading-slash path with 400", async () => {
    _setRoutesForTests([]);

    const result = await dispatchInternal(makeCtx(), {
      method: "GET",
      path: "v1/oops",
    });

    expect(result.status).toBe(400);
  });

  it("matches the same route whether called with /api/v1/..., /v1/..., or /...", async () => {
    _setRoutesForTests([
      makeRoute("get", "/product-analytics/search", () => ({ ok: true })),
    ]);

    const variants = [
      "/api/v1/product-analytics/search",
      "/v1/product-analytics/search",
      "/product-analytics/search",
    ];
    for (const path of variants) {
      const result = await dispatchInternal(makeCtx(), {
        method: "GET",
        path,
      });
      expect(result).toEqual({ status: 200, body: { ok: true } });
    }
  });

  it("JSON-serializes the response body the way res.json would (Date -> ISO, drops undefined)", async () => {
    const when = new Date("2026-01-02T03:04:05.000Z");
    _setRoutesForTests([
      makeRoute("get", "/wire", () => ({ when, keep: 1, drop: undefined })),
    ]);

    const result = await dispatchInternal(makeCtx(), {
      method: "GET",
      path: "/v1/wire",
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      when: "2026-01-02T03:04:05.000Z",
      keep: 1,
    });
  });

  it("returns 400 for a malformed percent-encoded path param", async () => {
    _setRoutesForTests([
      makeRoute("get", "/features/:id", () => ({ ok: true })),
    ]);

    const result = await dispatchInternal(makeCtx(), {
      method: "GET",
      path: "/v1/features/%E0%A4",
    });

    expect(result.status).toBe(400);
    expect(result.body).toEqual({
      message: expect.stringContaining("Malformed path parameter"),
    });
  });

  it("normalizes req.path to the canonical /api/v1 form regardless of input prefix", async () => {
    let seenPath: string | undefined;
    _setRoutesForTests([
      makeRoute("get", "/whereami", (req) => {
        seenPath = req.path;
        return { ok: true };
      }),
    ]);

    await dispatchInternal(makeCtx(), {
      method: "GET",
      path: "/whereami",
    });

    expect(seenPath).toBe("/api/v1/whereami");
  });

  it("exposes checkPermissions that delegates to the caller's role and denies when it throws", async () => {
    let received: { permission: string; project: unknown } | undefined;
    _setRoutesForTests([
      makeRoute("post", "/guarded", (req) => {
        req.checkPermissions("manageFeatures", "proj_1");
        return { ok: true };
      }),
    ]);

    const denyingCtx = makeCtx({
      requirePermission: ((permission: string, project: unknown) => {
        received = { permission, project };
        throw new Error("You do not have permission to complete that action.");
      }) as unknown as ReqContext["requirePermission"],
    });

    const result = await dispatchInternal(denyingCtx, {
      method: "POST",
      path: "/v1/guarded",
    });

    // A plain Error thrown from the handler maps to 400, exactly as the REST
    // wrapper would map it for a real HTTP caller.
    expect(result.status).toBe(400);
    expect(result.body).toEqual({
      message: "You do not have permission to complete that action.",
    });
    expect(received).toEqual({
      permission: "manageFeatures",
      project: "proj_1",
    });
  });

  it("forwards the caller's superAdmin flag to req.user", async () => {
    const seen: Array<boolean | undefined> = [];
    _setRoutesForTests([
      makeRoute("get", "/su", (req) => {
        seen.push(req.user?.superAdmin);
        return { ok: true };
      }),
    ]);

    await dispatchInternal(makeCtx({ superAdmin: true }), {
      method: "GET",
      path: "/v1/su",
    });
    await dispatchInternal(makeCtx({ superAdmin: false }), {
      method: "GET",
      path: "/v1/su",
    });

    expect(seen).toEqual([true, false]);
  });

  it("ignores a query string included in the path itself", async () => {
    _setRoutesForTests([
      makeRoute("get", "/things", (req) => ({ q: req.query })),
    ]);

    const result = await dispatchInternal(makeCtx(), {
      method: "GET",
      path: "/api/v1/things?ignored=true",
      query: { sort: "name" },
    });

    expect(result).toEqual({ status: 200, body: { q: { sort: "name" } } });
  });
});

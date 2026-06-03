import type { Request, Response, NextFunction } from "express";
import type { ReqContext } from "back-end/types/request";
import type { OpenApiRoute } from "back-end/src/util/handler";

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

// Factory for OpenApiRoute fixtures. The handler is the real Express handler
// shape (req, res, next) — exactly what allRoutes contains.
function makeRoute(
  method: "get" | "post" | "put" | "patch" | "delete",
  path: string,
  handler: (req: Request, res: Response, next: NextFunction) => unknown,
): OpenApiRoute {
  return {
    method,
    path,
    operationId: `op_${method}_${path}`,
    handler,
    schemas: {},
  } as unknown as OpenApiRoute;
}

afterEach(() => {
  _setRoutesForTests(null);
});

describe("dispatchInternal", () => {
  it("returns 200 with body for a matching GET", async () => {
    _setRoutesForTests([
      makeRoute("get", "/feature-keys", (_req, res) => {
        res.status(200).json({ keys: ["a", "b"] });
      }),
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
    _setRoutesForTests([
      makeRoute("get", "/features", (_req, res) => {
        res.status(200).json({});
      }),
    ]);

    const result = await dispatchInternal(makeCtx(), {
      method: "POST",
      path: "/v1/features",
    });

    expect(result.status).toBe(404);
  });

  it("extracts path params and forwards them to the handler", async () => {
    let receivedParams: Record<string, string> | undefined;
    _setRoutesForTests([
      makeRoute("get", "/features/:id", (req, res) => {
        receivedParams = req.params as Record<string, string>;
        res.status(200).json({ id: req.params.id });
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
      makeRoute("post", "/things", (req, res) => {
        received = { query: req.query, body: req.body };
        res.status(201).json({ ok: true });
      }),
    ]);

    const result = await dispatchInternal(makeCtx(), {
      method: "POST",
      path: "/v1/things",
      query: { sort: "name" },
      body: { name: "x", count: 3 },
    });

    expect(result).toEqual({ status: 201, body: { ok: true } });
    expect(received).toEqual({
      query: { sort: "name" },
      body: { name: "x", count: 3 },
    });
  });

  it("translates a thrown handler error into a 500", async () => {
    _setRoutesForTests([
      makeRoute("get", "/boom", () => {
        throw new Error("kaboom");
      }),
    ]);

    const result = await dispatchInternal(makeCtx(), {
      method: "GET",
      path: "/v1/boom",
    });

    expect(result.status).toBe(500);
    expect(result.body).toEqual({ message: "kaboom" });
  });

  it("translates a next(err) call into a 500", async () => {
    _setRoutesForTests([
      makeRoute("get", "/next-err", (_req, _res, next) => {
        next(new Error("middleware failure"));
      }),
    ]);

    const result = await dispatchInternal(makeCtx(), {
      method: "GET",
      path: "/v1/next-err",
    });

    expect(result.status).toBe(500);
    expect(result.body).toEqual({ message: "middleware failure" });
  });

  it("returns 500 if the handler never sends a response", async () => {
    _setRoutesForTests([
      makeRoute("get", "/silent", () => {
        // Intentionally do nothing
      }),
    ]);

    const result = await dispatchInternal(makeCtx(), {
      method: "GET",
      path: "/v1/silent",
    });

    expect(result.status).toBe(500);
    expect(result.body).toEqual({
      message: "Handler did not send a response",
    });
  });

  it("preserves a non-2xx status the handler chose (e.g. validation 400)", async () => {
    _setRoutesForTests([
      makeRoute("post", "/validate", (_req, res) => {
        res.status(400).json({ message: "bad input" });
      }),
    ]);

    const result = await dispatchInternal(makeCtx(), {
      method: "POST",
      path: "/v1/validate",
      body: { foo: "bar" },
    });

    expect(result).toEqual({ status: 400, body: { message: "bad input" } });
  });

  it("invokes onSuccess hook for 2xx and skips it for non-2xx", async () => {
    _setRoutesForTests([
      makeRoute("get", "/good", (_req, res) => {
        res.status(200).json({ a: 1 });
      }),
      makeRoute("get", "/bad", (_req, res) => {
        res.status(400).json({ message: "no" });
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
      makeRoute("get", "/whoami", (req, res) => {
        seenOrgId = (req as unknown as { context: { org: { id: string } } })
          .context.org.id;
        res.status(200).json({ org: seenOrgId });
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
      makeRoute("get", "/product-analytics/search", (_req, res) => {
        res.status(200).json({ ok: true });
      }),
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
      makeRoute("get", "/wire", (_req, res) => {
        res.status(200).json({ when, keep: 1, drop: undefined });
      }),
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
      makeRoute("get", "/features/:id", (_req, res) => {
        res.status(200).json({ ok: true });
      }),
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

  it("honors err.status and err.conflicts carried on a next(err)", async () => {
    _setRoutesForTests([
      makeRoute("post", "/conflict", (_req, _res, next) => {
        const err = Object.assign(new Error("revision is stale"), {
          status: 409,
          conflicts: [{ field: "base" }],
        });
        next(err);
      }),
    ]);

    const result = await dispatchInternal(makeCtx(), {
      method: "POST",
      path: "/v1/conflict",
    });

    expect(result.status).toBe(409);
    expect(result.body).toEqual({
      message: "revision is stale",
      conflicts: [{ field: "base" }],
    });
  });

  it("normalizes req.path to the canonical /api/v1 form regardless of input prefix", async () => {
    let seenPath: string | undefined;
    _setRoutesForTests([
      makeRoute("get", "/whereami", (req, res) => {
        seenPath = req.path;
        res.status(200).json({ ok: true });
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
      makeRoute("post", "/guarded", (req, res) => {
        (
          req as unknown as {
            checkPermissions: (p: string, project?: unknown) => void;
          }
        ).checkPermissions("manageFeatures", "proj_1");
        res.status(200).json({ ok: true });
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

    expect(result.status).toBe(500);
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
      makeRoute("get", "/su", (req, res) => {
        seen.push(
          (req as unknown as { user?: { superAdmin?: boolean } }).user
            ?.superAdmin,
        );
        res.status(200).json({ ok: true });
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
      makeRoute("get", "/things", (req, res) => {
        res.status(200).json({ q: req.query });
      }),
    ]);

    const result = await dispatchInternal(makeCtx(), {
      method: "GET",
      path: "/api/v1/things?ignored=true",
      query: { sort: "name" },
    });

    expect(result).toEqual({ status: 200, body: { q: { sort: "name" } } });
  });
});

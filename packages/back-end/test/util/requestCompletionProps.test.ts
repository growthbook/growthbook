import type { Request, Response } from "express";
import { getRequestCompletionProps } from "back-end/src/util/logger";
import { countMongoCalls } from "back-end/src/util/mongoCallStats";

function request(route: unknown, baseUrl = "/api/v1") {
  return { route, baseUrl } as Request;
}
const status = (statusCode: number) => ({ statusCode }) as Response;

describe("getRequestCompletionProps", () => {
  it("logs the full route on success", () => {
    expect(
      getRequestCompletionProps(
        request({ path: "/features/:id" }),
        status(200),
      ),
    ).toEqual({ route: "/api/v1/features/:id", routePath: "/features/:id" });
  });

  it("logs only the route path on errors", () => {
    expect(
      getRequestCompletionProps(
        request({ path: "/features/:id" }),
        status(500),
      ),
    ).toEqual({ routePath: "/features/:id" });
  });

  it("logs nothing when no route matched", () => {
    expect(getRequestCompletionProps(request(undefined), status(404))).toEqual(
      {},
    );
  });

  it("adds the mongo summary for counted requests", () => {
    const req = request({ path: "/x" });
    countMongoCalls(req, status(200), () => undefined);
    expect(getRequestCompletionProps(req, status(200)).mongo).toEqual({
      calls: 0,
      sequential: 0,
      wallMs: 0,
    });
  });

  it("never throws", () => {
    const req = {
      get route(): unknown {
        throw new Error("boom");
      },
    } as Request;
    expect(getRequestCompletionProps(req, status(200))).toEqual({});
  });
});

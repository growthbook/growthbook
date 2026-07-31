import { Request } from "express";
import { ReqContextClass } from "back-end/src/services/context";

// Pure request-shape logic, so exercise it on the prototype rather than standing
// up a full context (which needs Mongo). `isRestApiRequest` is set by the
// `/api/v*` router for both auth branches — that, not the auth scheme, is the
// discriminator.
function makeContext({
  isRestApiRequest,
  body = {},
  query = {},
  canBypass = true,
}: {
  isRestApiRequest: boolean;
  body?: Record<string, unknown>;
  query?: Record<string, string>;
  canBypass?: boolean;
}): ReqContextClass {
  return Object.assign(Object.create(ReqContextClass.prototype), {
    req: { body, query, headers: {}, isRestApiRequest } as unknown as Request,
    permissions: { canBypassApprovalChecks: () => canBypass },
  });
}

const FLAGS = ["ignoreWarnings", "skipSchemaValidation", "skipHooks"] as const;

describe("request override flags", () => {
  describe.each(FLAGS)("%s", (flag) => {
    it("is honored from the request body on the REST API", () => {
      expect(
        makeContext({ isRestApiRequest: true, body: { [flag]: true } })[flag],
      ).toBe(true);
    });

    // The querystring aliases were removed from the REST API; every write
    // endpoint declares these in its body schema instead.
    it("is ignored in the querystring on the REST API", () => {
      expect(
        makeContext({ isRestApiRequest: true, query: { [flag]: "true" } })[
          flag
        ],
      ).toBe(false);
    });

    // The app's own routes keep the querystring path: the front-end's generic
    // soft-warning retry replays a request by rewriting its URL.
    it("is still honored in the querystring for an app request", () => {
      expect(
        makeContext({ isRestApiRequest: false, query: { [flag]: "true" } })[
          flag
        ],
      ).toBe(true);
    });

    it("is off when neither form is present", () => {
      expect(makeContext({ isRestApiRequest: true })[flag]).toBe(false);
    });

    it("only honors a boolean true in the body, not a truthy string", () => {
      expect(
        makeContext({ isRestApiRequest: true, body: { [flag]: "true" } })[flag],
      ).toBe(false);
    });
  });

  // Both privileged flags stay gated on org-wide bypass authority regardless of
  // which form asked for them.
  describe.each(["skipSchemaValidation", "skipHooks"] as const)(
    "%s permission gate",
    (flag) => {
      it("is ignored without org-wide bypass authority", () => {
        expect(
          makeContext({
            isRestApiRequest: true,
            body: { [flag]: true },
            canBypass: false,
          })[flag],
        ).toBe(false);
      });
    },
  );

  // Background jobs have no request and always ignore soft warnings, but must
  // never skip validation.
  it("defaults correctly with no request at all", () => {
    const background = Object.assign(Object.create(ReqContextClass.prototype), {
      isRestApiRequest: false,
      req: undefined,
      permissions: { canBypassApprovalChecks: () => true },
    }) as ReqContextClass;
    expect(background.ignoreWarnings).toBe(true);
    expect(background.skipSchemaValidation).toBe(false);
    expect(background.skipHooks).toBe(false);
  });
});

import { Request } from "express";
import { ReqContextClass } from "back-end/src/services/context";

// Pure request-shape logic, so exercise it on the prototype rather than standing
// up a full context (which needs Mongo).
function makeContext({
  body = {},
  query = {},
  canBypass = true,
}: {
  body?: Record<string, unknown>;
  query?: Record<string, string>;
  canBypass?: boolean;
} = {}): ReqContextClass {
  return Object.assign(Object.create(ReqContextClass.prototype), {
    req: { body, query, headers: {} } as unknown as Request,
    permissions: { canBypassApprovalChecks: () => canBypass },
  });
}

const FLAGS = ["ignoreWarnings", "skipSchemaValidation", "skipHooks"] as const;

describe("request override flags", () => {
  describe.each(FLAGS)("%s", (flag) => {
    it("is honored from the request body", () => {
      expect(makeContext({ body: { [flag]: true } })[flag]).toBe(true);
    });

    // Body-canonical: the app's `?ignoreWarnings=true` retry is folded into the
    // body by middleware, so the getter never reads the querystring.
    it("ignores the querystring", () => {
      expect(makeContext({ query: { [flag]: "true" } })[flag]).toBe(false);
    });

    it("is off when absent", () => {
      expect(makeContext()[flag]).toBe(false);
    });

    it("only honors a boolean true, not a truthy string", () => {
      expect(makeContext({ body: { [flag]: "true" } })[flag]).toBe(false);
    });
  });

  // Both privileged flags stay gated on org-wide bypass authority.
  describe.each(["skipSchemaValidation", "skipHooks"] as const)(
    "%s permission gate",
    (flag) => {
      it("is ignored without org-wide bypass authority", () => {
        expect(
          makeContext({ body: { [flag]: true }, canBypass: false })[flag],
        ).toBe(false);
      });
    },
  );

  // Background jobs have no request and always ignore soft warnings, but must
  // never skip validation.
  it("defaults correctly with no request at all", () => {
    const background = Object.assign(Object.create(ReqContextClass.prototype), {
      req: undefined,
      permissions: { canBypassApprovalChecks: () => true },
    }) as ReqContextClass;
    expect(background.ignoreWarnings).toBe(true);
    expect(background.skipSchemaValidation).toBe(false);
    expect(background.skipHooks).toBe(false);
  });
});

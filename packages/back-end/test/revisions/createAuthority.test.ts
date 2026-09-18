import {
  assertCanCreateConstantInState,
  assertCanCreateConfigInState,
} from "back-end/src/revisions/createAuthority";
import type { ReqContext } from "back-end/types/request";

/**
 * Creating with env-scoped live state is a publish into those environments.
 * Without these gates, create was checked with NO_ENVIRONMENT_BINDING while the
 * body carried environmentValues / scopedOverrides that served immediately — so
 * an env-limited role could reach production through the create door while the
 * identical update was refused.
 */

function ctx(allowedEnvs: string[]): ReqContext {
  return {
    org: {
      id: "org_ca",
      settings: {
        environments: [{ id: "dev" }, { id: "staging" }, { id: "production" }],
      },
    },
    permissions: {
      canRevisionAction: (
        _model: string,
        _action: string,
        _entity: unknown,
        envs: string[],
      ) => envs.every((e) => allowedEnvs.includes(e)),
      throwPermissionError: () => {
        throw new Error("permission denied");
      },
    },
  } as unknown as ReqContext;
}

describe("assertCanCreateConstantInState", () => {
  it("refuses env values outside the caller's publish grant", () => {
    expect(() =>
      assertCanCreateConstantInState(ctx(["dev"]), {
        project: "",
        environmentValues: { production: "boom" },
      }),
    ).toThrow("permission denied");
  });

  it("allows env values inside the grant", () => {
    expect(() =>
      assertCanCreateConstantInState(ctx(["dev"]), {
        project: "",
        environmentValues: { dev: "ok" },
      }),
    ).not.toThrow();
  });

  it("asks nothing for a create with no env values", () => {
    // The base value carries no environment dimension — create authority
    // already covered it, and demanding more here would break every plain
    // create by an env-limited role.
    expect(() =>
      assertCanCreateConstantInState(ctx([]), { project: "" }),
    ).not.toThrow();
  });
});

describe("assertCanCreateConfigInState", () => {
  it("refuses flavors scoped to environments outside the grant", () => {
    expect(() =>
      assertCanCreateConfigInState(ctx(["dev"]), {
        project: "",
        scopedOverrides: [{ environments: ["production"] }],
      }),
    ).toThrow("permission denied");
  });

  it("treats a scope-less flavor as reaching every environment", () => {
    // scopedOverridesFootprint resolves an entry naming no environments to the
    // full universe — the fail-closed reading, never "nowhere".
    expect(() =>
      assertCanCreateConfigInState(ctx(["dev"]), {
        project: "",
        scopedOverrides: [{}],
      }),
    ).toThrow("permission denied");
  });

  it("allows flavors inside the grant and asks nothing without flavors", () => {
    expect(() =>
      assertCanCreateConfigInState(ctx(["dev"]), {
        project: "",
        scopedOverrides: [{ environments: ["dev"] }],
      }),
    ).not.toThrow();
    expect(() =>
      assertCanCreateConfigInState(ctx([]), { project: "" }),
    ).not.toThrow();
  });
});

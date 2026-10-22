import {
  canCustomize,
  describeGrant,
  forHolder,
  initialPermissions,
  orgKeyFields,
  presetOfKey,
  rulesProblem,
  startCustomizing,
  tokenFields,
} from "@/components/Settings/apiKeyPermissions";

const ENTERPRISE = { roles: true, readonly: true, confirmations: true };
const PRO = { roles: true, readonly: true, confirmations: false };
const FREE = { roles: false, readonly: false, confirmations: false };

const RECOMMENDED = [{ actions: ["recommended"] }];
const key = (fields = {}) => ({
  role: "admin",
  limitAccessByEnvironment: false,
  environments: [],
  ...fields,
});

describe("presetOfKey", () => {
  it.each([
    ["an admin key with no rules", key(), "system", "full"],
    ["a read-only key", key({ role: "readonly" }), "system", "readonly"],
    [
      "an admin key holding recommended actions for a member",
      key({ confirmRules: RECOMMENDED }),
      "user",
      "hitl",
    ],
    [
      "an admin key holding recommended actions as System",
      key({ confirmRules: RECOMMENDED }),
      "system",
      null,
    ],
    [
      "an admin key holding every action",
      key({ confirmRules: [{ actions: ["*"] }] }),
      "user",
      null,
    ],
    ["an engineer key", key({ role: "engineer" }), "system", null],
    [
      "a key limited by environment",
      key({ limitAccessByEnvironment: true, environments: ["dev"] }),
      "system",
      null,
    ],
    ["an unscoped token", key({ role: undefined }), "pat", "full"],
    [
      "a token scoped to read only",
      key({ role: "readonly", scoped: true }),
      "pat",
      "readonly",
    ],
    ["a token scoped to admin", key({ scoped: true }), "pat", null],
  ] as const)("reads %s as %s", (_, saved, holder, preset) => {
    expect(presetOfKey(saved, holder)).toBe(preset);
  });
});

describe("saving a preset", () => {
  it("gives Human-in-the-Loop the recommended rules on an admin role", () => {
    const value = initialPermissions(undefined, "user", ENTERPRISE);
    expect(value.preset).toBe("hitl");
    expect(orgKeyFields(value)).toMatchObject({
      role: "admin",
      limitAccessByEnvironment: false,
      confirmRules: RECOMMENDED,
    });
  });

  it("starts a System key with nothing picked", () => {
    expect(
      initialPermissions(undefined, "system", ENTERPRISE).preset,
    ).toBeNull();
  });

  it("saves a full-access token unscoped and a read-only one scoped", () => {
    const base = initialPermissions(undefined, "pat", ENTERPRISE);
    expect(tokenFields({ ...base, preset: "full" })).toEqual({
      confirmRules: null,
    });
    expect(tokenFields({ ...base, preset: "readonly" })).toEqual({
      scopedRole: "readonly",
      limitAccessByEnvironment: false,
      environments: [],
      additionalRoles: undefined,
      projectRoles: undefined,
      confirmRules: null,
    });
  });
});

describe("switching between System and User", () => {
  it("drops Human-in-the-Loop for System and defaults to it for User", () => {
    const user = initialPermissions(undefined, "user", ENTERPRISE);
    const system = forHolder(user, "system", ENTERPRISE);
    expect(system.preset).toBeNull();
    expect(forHolder(system, "user", ENTERPRISE).preset).toBe("hitl");
  });

  it("leaves a custom form alone", () => {
    const custom = startCustomizing(
      initialPermissions(undefined, "user", ENTERPRISE),
    );
    expect(forHolder(custom, "system", ENTERPRISE)).toEqual(custom);
  });

  it("shows a role picked as System as a restriction once it acts as User", () => {
    const custom = startCustomizing(
      forHolder(
        initialPermissions(undefined, "system", ENTERPRISE),
        "system",
        ENTERPRISE,
      ),
    );
    const engineer = {
      ...custom,
      scope: { ...custom.scope, role: "engineer" },
    };
    expect(forHolder(engineer, "user", ENTERPRISE)).toMatchObject({
      restricted: true,
      scope: { role: "engineer" },
    });
  });
});

describe("startCustomizing", () => {
  it("starts from the preset it replaces and keeps it to go back to", () => {
    const custom = startCustomizing(
      initialPermissions(undefined, "pat", ENTERPRISE),
    );
    expect(custom).toMatchObject({
      preset: "hitl",
      customizing: true,
      scope: { role: "admin" },
      requireConfirmation: true,
    });
  });
});

describe("plan limits", () => {
  it("only offers Full access on an admin-only plan", () => {
    expect(initialPermissions(undefined, "pat", FREE).preset).toBe("full");
    expect(initialPermissions(undefined, "system", FREE).preset).toBe("full");
    expect(canCustomize(FREE)).toBe(false);
  });

  it("leaves the choice open without Human-in-the-Loop", () => {
    expect(initialPermissions(undefined, "pat", PRO).preset).toBeNull();
    expect(canCustomize(PRO)).toBe(true);
  });

  it("starts Customize from admin when Read only isn't available", () => {
    const value = startCustomizing(
      initialPermissions(undefined, "system", {
        ...PRO,
        readonly: false,
      }),
    );
    expect(orgKeyFields(value).role).toBe("admin");
  });
});

describe("editing a saved token", () => {
  it("keeps a token scoped to admin scoped", () => {
    const saved = key({ scoped: true });
    expect(tokenFields(initialPermissions(saved, "pat", ENTERPRISE))).toEqual(
      expect.objectContaining({ scopedRole: "admin" }),
    );
  });

  it("drops the scope when the owner lifts it", () => {
    const value = initialPermissions(key({ scoped: true }), "pat", ENTERPRISE);
    expect(tokenFields({ ...value, restricted: false })).toEqual({
      confirmRules: null,
    });
  });
});

describe("rulesProblem", () => {
  it("flags a confirmation rule with no actions", () => {
    const custom = startCustomizing(
      initialPermissions(undefined, "pat", ENTERPRISE),
    );
    expect(rulesProblem(custom)).toBeNull();
    expect(rulesProblem({ ...custom, rules: [{ actions: [] }] })).toMatch(
      /at least one action/,
    );
  });
});

describe("describeGrant", () => {
  it("reads a grant from before consent asked as full access", () => {
    expect(describeGrant(null)).toEqual({
      preset: "full",
      scope: null,
      confirmations: false,
    });
  });

  it("names the preset a grant matches", () => {
    expect(describeGrant({ scopedRole: "readonly" }).preset).toBe("readonly");
    expect(describeGrant({ confirmRules: RECOMMENDED }).preset).toBe("hitl");
  });

  it("shows custom permissions' role rules and confirmations", () => {
    expect(
      describeGrant({
        scopedRole: "engineer",
        confirmRules: [{ actions: ["*"] }],
      }),
    ).toMatchObject({
      preset: null,
      scope: { role: "engineer" },
      confirmations: true,
    });
  });
});

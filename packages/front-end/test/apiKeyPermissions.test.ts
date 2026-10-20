import {
  forHolder,
  initialPermissions,
  orgKeyFields,
  presetOfKey,
  startCustomizing,
  tokenFields,
} from "@/components/Settings/apiKeyPermissions";

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
  ] as const)("reads %s as %s", (_, saved, holder, preset) => {
    expect(presetOfKey(saved, holder)).toBe(preset);
  });
});

describe("saving a preset", () => {
  it("gives Human-in-the-Loop the recommended rules on an admin role", () => {
    const value = initialPermissions(undefined, "user");
    expect(value.preset).toBe("hitl");
    expect(orgKeyFields(value)).toMatchObject({
      role: "admin",
      limitAccessByEnvironment: false,
      confirmRules: RECOMMENDED,
    });
  });

  it("starts a System key with nothing picked", () => {
    expect(initialPermissions(undefined, "system").preset).toBeNull();
  });

  it("saves a full-access token unscoped and a read-only one scoped", () => {
    const base = initialPermissions(undefined, "pat");
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
    const user = initialPermissions(undefined, "user");
    const system = forHolder(user, "system");
    expect(system.preset).toBeNull();
    expect(forHolder(system, "user").preset).toBe("hitl");
  });

  it("leaves a custom form alone", () => {
    const custom = startCustomizing(initialPermissions(undefined, "user"));
    expect(forHolder(custom, "system")).toBe(custom);
  });
});

describe("startCustomizing", () => {
  it("starts from the preset it replaces and keeps it to go back to", () => {
    const custom = startCustomizing(initialPermissions(undefined, "pat"));
    expect(custom).toMatchObject({
      preset: "hitl",
      customizing: true,
      scope: { role: "admin" },
      requireConfirmation: true,
    });
  });
});

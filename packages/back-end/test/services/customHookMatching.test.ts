import { CustomHookInterface } from "shared/validators";
import { customHookMatchesScope } from "back-end/src/models/CustomHookModel";

type Scope = Pick<CustomHookInterface, "entityType" | "entityId" | "projects">;

const hook = (over: Partial<Scope>): Scope => ({
  entityType: undefined,
  entityId: undefined,
  projects: [],
  ...over,
});

describe("customHookMatchesScope", () => {
  it("matches a global hook (no entityType, no projects) for any target", () => {
    expect(customHookMatchesScope(hook({}), { project: "prj_1" })).toBe(true);
    expect(customHookMatchesScope(hook({}), {})).toBe(true);
  });

  it("matches a project-scoped hook only for its projects", () => {
    const h = hook({ projects: ["prj_a", "prj_b"] });
    expect(customHookMatchesScope(h, { project: "prj_a" })).toBe(true);
    expect(customHookMatchesScope(h, { project: "prj_c" })).toBe(false);
    // No project on the target (global default project)
    expect(customHookMatchesScope(h, {})).toBe(false);
  });

  it("matches a feature-scoped hook only for its exact entityId", () => {
    const h = hook({ entityType: "feature", entityId: "feat_1" });
    expect(customHookMatchesScope(h, { entityId: "feat_1" })).toBe(true);
    expect(customHookMatchesScope(h, { entityId: "feat_2" })).toBe(false);
  });

  it("matches a config-scoped hook only for its exact config key", () => {
    const h = hook({ entityType: "config", entityId: "checkout_limits" });
    expect(customHookMatchesScope(h, { entityId: "checkout_limits" })).toBe(
      true,
    );
    expect(customHookMatchesScope(h, { entityId: "other_config" })).toBe(false);
  });

  it("ignores project for an entity-scoped hook (entityId is authoritative)", () => {
    const h = hook({
      entityType: "config",
      entityId: "checkout_limits",
      // A stray project must not widen an entity-scoped hook.
      projects: ["prj_a"],
    });
    expect(
      customHookMatchesScope(h, { entityId: "checkout_limits", project: "" }),
    ).toBe(true);
    expect(
      customHookMatchesScope(h, { entityId: "nope", project: "prj_a" }),
    ).toBe(false);
  });

  it("matches a config-scoped hook for the config itself and its descendants", () => {
    const h = hook({ entityType: "config", entityId: "base_preset" });
    expect(customHookMatchesScope(h, { entityId: "base_preset" })).toBe(true);
    expect(
      customHookMatchesScope(h, {
        entityId: "child_preset",
        ancestorIds: ["mid_preset", "base_preset"],
      }),
    ).toBe(true);
    // A config in an unrelated family
    expect(
      customHookMatchesScope(h, {
        entityId: "other",
        ancestorIds: ["other_base"],
      }),
    ).toBe(false);
    // No ancestor info provided — a descendant can't be recognized as one.
    expect(customHookMatchesScope(h, { entityId: "child_preset" })).toBe(false);
  });

  it("ignores ancestorIds for global/project hooks (projects decide)", () => {
    const h = hook({ projects: ["prj_a"] });
    expect(
      customHookMatchesScope(h, {
        entityId: "child_preset",
        project: "prj_b",
        ancestorIds: ["base_preset"],
      }),
    ).toBe(false);
  });
});

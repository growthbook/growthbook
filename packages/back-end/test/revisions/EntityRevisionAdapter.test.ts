import { filterUpdatableChanges } from "back-end/src/revisions/EntityRevisionAdapter";

describe("filterUpdatableChanges", () => {
  const updatable = new Set(["value", "schema", "parent", "extends"]);

  it("keeps a null clear so it stays distinguishable from unchanged", () => {
    // The deferred-publish guard (config.adapter assertPublishable) tests
    // `"schema" in filteredChanges` to tell a schema-clear (null) from an
    // unchanged schema. That only works because a null clear survives this
    // filter — `?? entity.schema` would otherwise resurrect the old schema and
    // desync the arm-time capture from the deferred fire.
    const filtered = filterUpdatableChanges(
      { schema: null },
      { schema: { type: "object", fields: [] } },
      updatable,
    );
    expect("schema" in filtered).toBe(true);
    expect(filtered.schema).toBeNull();
  });

  it("drops undefined (an undefined change is a no-op, not a clear)", () => {
    const filtered = filterUpdatableChanges(
      { schema: undefined },
      { schema: { type: "object", fields: [] } },
      updatable,
    );
    expect("schema" in filtered).toBe(false);
  });

  it("drops a change equal to the live value", () => {
    const schema = { type: "object" as const, fields: [] };
    const filtered = filterUpdatableChanges({ schema }, { schema }, updatable);
    expect("schema" in filtered).toBe(false);
  });

  it("drops keys outside the updatable allowlist", () => {
    const filtered = filterUpdatableChanges(
      { value: "v2", organization: "org_x" },
      { value: "v1", organization: "org_a" },
      updatable,
    );
    expect(filtered).toEqual({ value: "v2" });
  });

  it("keeps a genuine change", () => {
    const filtered = filterUpdatableChanges(
      { parent: "base", extends: ["mixin"] },
      { parent: "", extends: [] },
      updatable,
    );
    expect(filtered).toEqual({ parent: "base", extends: ["mixin"] });
  });
});

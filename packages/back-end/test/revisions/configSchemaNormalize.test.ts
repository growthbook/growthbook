import type { SimpleSchema } from "shared/types/feature";
import type { ConfigInterface } from "shared/types/config";
import type { AncestorFieldCollision } from "shared/util";
import { normalizeConfigChangesAgainstAncestors } from "back-end/src/revisions/adapters/configSchemaNormalize";

const field = (key: string): SimpleSchema["fields"][number] =>
  ({
    key,
    type: "string",
    required: false,
    default: "",
    description: "",
  }) as SimpleSchema["fields"][number];

const schemaWith = (...keys: string[]): SimpleSchema =>
  ({
    type: "object",
    fields: keys.map(field),
    additionalProperties: false,
  }) as unknown as SimpleSchema;

const entity = (overrides: Partial<ConfigInterface>): ConfigInterface =>
  ({
    key: "child",
    parent: "base",
    extends: undefined,
    value: "{}",
    schema: schemaWith("x"),
    ...overrides,
  }) as ConfigInterface;

// The injected normalizer strips fixed ancestor-owned key sets from the schema
// passed to it, reporting them as identical/conflicting collisions — a pure
// stand-in for ConfigModel.normalizeSchemaAgainstAncestors.
const stripKeys =
  (identicalOwned: Set<string>, conflictingOwned: Set<string> = new Set()) =>
  async (
    _config: {
      key?: string;
      parent?: string;
      extends?: string[];
      value?: string;
    },
    schema: SimpleSchema | undefined,
  ): Promise<{
    schema: SimpleSchema | undefined;
    identical: AncestorFieldCollision[];
    conflicting: AncestorFieldCollision[];
  }> => {
    const fields = schema?.fields ?? [];
    const identical: AncestorFieldCollision[] = [];
    const conflicting: AncestorFieldCollision[] = [];
    const kept = fields.filter((f) => {
      if (identicalOwned.has(f.key)) {
        identical.push({ key: f.key, owner: "base" });
        return false;
      }
      if (conflictingOwned.has(f.key)) {
        conflicting.push({ key: f.key, owner: "base" });
        return false;
      }
      return true;
    });
    return {
      schema:
        kept.length === fields.length ? schema : { ...schema!, fields: kept },
      identical,
      conflicting,
    };
  };

describe("normalizeConfigChangesAgainstAncestors", () => {
  it("strips ancestor-owned fields from a staged schema change", async () => {
    const e = entity({ schema: schemaWith("y") });
    const changes: Record<string, unknown> = { schema: schemaWith("x", "y") };

    const out = await normalizeConfigChangesAgainstAncestors(
      e,
      changes,
      stripKeys(new Set(["x"])),
    );

    // The ancestor now owns "x"; the staged schema must be reduced to just "y".
    expect(
      (out.changes.schema as SimpleSchema).fields.map((f) => f.key),
    ).toEqual(["y"]);
    expect(out.identical).toEqual([{ key: "x", owner: "base" }]);
    expect(out.conflicting).toEqual([]);
  });

  it("propagates conflicting collisions for the caller to reject", async () => {
    const e = entity({ schema: schemaWith("y") });
    const changes: Record<string, unknown> = { schema: schemaWith("x", "y") };

    const out = await normalizeConfigChangesAgainstAncestors(
      e,
      changes,
      stripKeys(new Set(), new Set(["x"])),
    );

    expect(out.conflicting).toEqual([{ key: "x", owner: "base" }]);
    expect(out.identical).toEqual([]);
  });

  it("normalizes (and classifies) the entity's own schema when only lineage changes", async () => {
    // No schema in the changes, but `parent` changed — the config's own schema
    // must still be re-normalized against the new ancestors, and a collision
    // with the NEW ancestors still classifies.
    const e = entity({ schema: schemaWith("x", "y"), parent: "oldBase" });
    const changes: Record<string, unknown> = { parent: "newBase" };

    const out = await normalizeConfigChangesAgainstAncestors(
      e,
      changes,
      stripKeys(new Set(), new Set(["x"])),
    );

    expect(
      (out.changes.schema as SimpleSchema).fields.map((f) => f.key),
    ).toEqual(["y"]);
    expect(out.conflicting).toEqual([{ key: "x", owner: "base" }]);
  });

  it("re-normalizes when `extends` changes even to undefined", async () => {
    const e = entity({ schema: schemaWith("x", "y"), extends: ["mixin"] });
    const changes: Record<string, unknown> = { extends: undefined };

    const out = await normalizeConfigChangesAgainstAncestors(
      e,
      changes,
      stripKeys(new Set(["x"])),
    );

    expect(
      (out.changes.schema as SimpleSchema).fields.map((f) => f.key),
    ).toEqual(["y"]);
  });

  it("leaves changes untouched when normalization strips nothing", async () => {
    const e = entity({ schema: schemaWith("y") });
    const changes: Record<string, unknown> = { schema: schemaWith("y") };

    const out = await normalizeConfigChangesAgainstAncestors(
      e,
      changes,
      stripKeys(new Set(["x"])),
    );

    expect(
      (out.changes.schema as SimpleSchema).fields.map((f) => f.key),
    ).toEqual(["y"]);
    expect(out.identical).toEqual([]);
    expect(out.conflicting).toEqual([]);
  });

  it("does not run normalization when neither schema nor lineage changed", async () => {
    const e = entity({ schema: schemaWith("x") });
    const changes: Record<string, unknown> = { value: '{"x":1}' };
    let called = false;
    const spy = async (
      c: Parameters<ReturnType<typeof stripKeys>>[0],
      s: SimpleSchema | undefined,
    ) => {
      called = true;
      return stripKeys(new Set(["x"]))(c, s);
    };

    const out = await normalizeConfigChangesAgainstAncestors(e, changes, spy);

    expect(called).toBe(false);
    expect("schema" in out.changes).toBe(false);
  });

  it("preserves an explicit schema clear (null) and normalizes nothing", async () => {
    const e = entity({ schema: schemaWith("x") });
    const changes: Record<string, unknown> = { schema: null };
    let called = false;
    const spy = async (
      c: Parameters<ReturnType<typeof stripKeys>>[0],
      s: SimpleSchema | undefined,
    ) => {
      called = true;
      return stripKeys(new Set(["x"]))(c, s);
    };

    const out = await normalizeConfigChangesAgainstAncestors(e, changes, spy);

    // A cleared schema has nothing to strip; null survives so it persists and
    // the downstream reconcile trigger (`schema !== undefined`) still fires.
    expect(called).toBe(false);
    expect(out.changes.schema).toBeNull();
  });

  it("keeps the schema clear (null) even when lineage also changes", async () => {
    // The revert-to-a-schema-less-revision case: `parent` moves AND schema is
    // cleared in the same change. The old schema must NOT be resurrected.
    const e = entity({ schema: schemaWith("x", "y"), parent: "oldBase" });
    const changes: Record<string, unknown> = {
      parent: "newBase",
      schema: null,
    };

    const out = await normalizeConfigChangesAgainstAncestors(
      e,
      changes,
      stripKeys(new Set(["x"])),
    );

    expect(out.changes.schema).toBeNull();
    expect(out.changes.parent).toBe("newBase");
    expect(out.identical).toEqual([]);
    expect(out.conflicting).toEqual([]);
  });

  it("does not mutate the input changes object", async () => {
    const e = entity({ schema: schemaWith("y") });
    const changes: Record<string, unknown> = { schema: schemaWith("x", "y") };

    const out = await normalizeConfigChangesAgainstAncestors(
      e,
      changes,
      stripKeys(new Set(["x"])),
    );

    expect((changes.schema as SimpleSchema).fields.map((f) => f.key)).toEqual([
      "x",
      "y",
    ]);
    expect(out.changes).not.toBe(changes);
  });
});

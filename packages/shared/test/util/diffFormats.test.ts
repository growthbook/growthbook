import {
  buildFullJson,
  buildFullJsonObject,
  buildMinimalJsonDiff,
  buildMinimalJsonDiffObject,
  type DiffCopyInput,
} from "../../src/util/diffFormats";

const input: DiffCopyInput = {
  entityName: "checkout-flow",
  diffs: [
    {
      title: "Default Value",
      a: "false",
      b: "true",
    },
    {
      title: "Ramp Schedule – Spring rollout",
      entityName: "Spring rollout",
      entityType: "ramp-schedule",
      a: "",
      b: '{\n  "name": "Spring rollout"\n}',
      supplemental: true,
    },
  ],
  raw: {
    title: "Feature revision",
    before: { defaultValue: "false", rules: [] },
    after: { defaultValue: "true", rules: [] },
  },
};

describe("buildMinimalJsonDiff", () => {
  it("derives changes from the raw schema shapes, keyed by schema field", () => {
    const doc = buildMinimalJsonDiffObject(input);
    expect(doc.name).toBe("checkout-flow");
    expect(doc.type).toBe("feature");
    expect(doc.changes).toEqual([
      {
        field: "defaultValue",
        change: "modified",
        before: "false",
        after: "true",
      },
    ]);
    expect(doc.supplemental).toEqual([
      {
        name: "Spring rollout",
        type: "ramp-schedule",
        change: "added",
        value: { name: "Spring rollout" },
      },
    ]);
  });

  it("uses the same schema for object-valued fields (environmentsEnabled)", () => {
    const doc = buildMinimalJsonDiffObject({
      entityName: "f",
      diffs: [],
      raw: {
        before: {
          environmentsEnabled: { production: true, dev: true },
          rules: [],
        },
        after: {
          environmentsEnabled: { production: false, staging: true, dev: true },
          rules: [],
        },
      },
    });
    expect(doc.changes).toEqual([
      {
        field: "environmentsEnabled",
        change: "modified",
        before: { production: true },
        after: { production: false, staging: true },
      },
    ]);
  });

  it("buckets id-keyed array changes into added/removed/modified with positions", () => {
    const doc = buildMinimalJsonDiffObject({
      entityName: "f",
      diffs: [],
      raw: {
        before: {
          rules: [
            { id: "r1", type: "force", value: "A" },
            { id: "r2", type: "force", value: "B" },
          ],
        },
        after: {
          rules: [
            { id: "r1", type: "force", value: "A2" },
            { id: "r3", type: "rollout", value: "C" },
          ],
        },
      },
    });
    const rules = (doc.changes as Record<string, unknown>[])[0];
    expect(rules.field).toBe("rules");
    expect(rules.change).toBe("modified");
    const items = rules.items as Record<string, unknown>;
    expect(items.added).toEqual([
      { index: 1, value: { id: "r3", type: "rollout", value: "C" } },
    ]);
    expect(items.removed).toEqual([
      { index: 1, value: { id: "r2", type: "force", value: "B" } },
    ]);
    expect(items.modified).toEqual([
      {
        id: "r1",
        beforeIndex: 0,
        afterIndex: 0,
        before: { value: "A" },
        after: { value: "A2" },
      },
    ]);
    expect(items.reordered).toBeUndefined();
    expect(items.order).toBeUndefined();
  });

  it("flags reorders of surviving items and emits the new id order", () => {
    const doc = buildMinimalJsonDiffObject({
      entityName: "f",
      diffs: [],
      raw: {
        before: {
          rules: [
            { id: "r1", value: "A" },
            { id: "r2", value: "B" },
          ],
        },
        after: {
          rules: [
            { id: "r2", value: "B" },
            { id: "r1", value: "A" },
          ],
        },
      },
    });
    const items = (doc.changes as Record<string, unknown>[])[0].items as Record<
      string,
      unknown
    >;
    expect(items.added).toEqual([]);
    expect(items.removed).toEqual([]);
    expect(items.modified).toEqual([]);
    expect(items.reordered).toBe(true);
    expect(items.order).toEqual(["r2", "r1"]);
  });

  it("does not flag a reorder when only insertions shift indices", () => {
    const doc = buildMinimalJsonDiffObject({
      entityName: "f",
      diffs: [
        {
          title: "Rules",
          a: JSON.stringify([{ id: "r1", value: "A" }]),
          b: JSON.stringify([
            { id: "r0", value: "Z" },
            { id: "r1", value: "A" },
          ]),
        },
      ],
    });
    const items = (doc.changes as Record<string, unknown>[])[0].items as Record<
      string,
      unknown
    >;
    expect(items.added).toEqual([
      { index: 0, value: { id: "r0", value: "Z" } },
    ]);
    expect(items.reordered).toBeUndefined();
  });

  it("prunes modified objects to their changed keys", () => {
    const doc = buildMinimalJsonDiffObject({
      entityName: "f",
      diffs: [
        {
          title: "Settings",
          a: JSON.stringify({ keep: 1, change: "x" }),
          b: JSON.stringify({ keep: 1, change: "y" }),
        },
      ],
    });
    expect((doc.changes as Record<string, unknown>[])[0]).toEqual({
      field: "Settings",
      change: "modified",
      before: { change: "x" },
      after: { change: "y" },
    });
  });

  it("handles an empty change set as valid JSON", () => {
    const doc = JSON.parse(
      buildMinimalJsonDiff({ entityName: "checkout-flow", diffs: [] }),
    );
    expect(doc).toEqual({
      name: "checkout-flow",
      type: "feature",
      changes: [],
    });
  });

  it("stringifies the object form when called as buildMinimalJsonDiff", () => {
    const str = buildMinimalJsonDiff(input);
    expect(JSON.parse(str)).toEqual(buildMinimalJsonDiffObject(input));
    // Pretty-printed (2-space indent).
    expect(str).toContain("\n  ");
  });
});

describe("buildFullJson", () => {
  it("emits the root entity's whole before/after plus supplemental entities", () => {
    const doc = buildFullJsonObject(input);
    expect(doc.name).toBe("checkout-flow");
    expect(doc.type).toBe("feature");
    expect(doc.before).toEqual({ defaultValue: "false", rules: [] });
    expect(doc.after).toEqual({ defaultValue: "true", rules: [] });
    expect(doc.supplemental).toEqual([
      {
        name: "Spring rollout",
        type: "ramp-schedule",
        before: null,
        after: { name: "Spring rollout" },
      },
    ]);
  });

  it("falls back to per-field diffs when no whole shape is available", () => {
    const doc = buildFullJsonObject({ ...input, raw: undefined });
    expect(doc.before).toBeUndefined();
    expect(doc.fields).toEqual([
      { name: "Default Value", before: false, after: true },
    ]);
    const supplemental = doc.supplemental as Array<{
      name: string;
      type: string;
    }>;
    expect(supplemental.map((e) => [e.name, e.type])).toEqual([
      ["Spring rollout", "ramp-schedule"],
    ]);
  });

  it("stringifies the object form when called as buildFullJson", () => {
    const str = buildFullJson(input);
    expect(JSON.parse(str)).toEqual(buildFullJsonObject(input));
  });
});

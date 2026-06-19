import { describe, expect, it } from "vitest";
import {
  buildFullJson,
  buildLLMDiff,
  buildMinimalJsonDiff,
  buildSummary,
  formatDiffForCopy,
  type DiffCopyInput,
} from "@/components/Reviews/diffCopyFormats";

const input: DiffCopyInput = {
  entityName: "checkout-flow",
  diffs: [
    {
      title: "Default Value",
      a: "false",
      b: "true",
      badges: [{ label: "Edit default value", action: "edit default value" }],
    },
    {
      title: "Ramp Schedule – Spring rollout",
      entityName: "Spring rollout",
      entityType: "ramp-schedule",
      a: "",
      b: '{\n  "name": "Spring rollout"\n}',
      supplemental: true,
      badges: [{ label: "Start ramp: Spring rollout", action: "start ramp" }],
    },
  ],
  raw: {
    title: "Feature revision",
    before: { defaultValue: "false", rules: [] },
    after: { defaultValue: "true", rules: [] },
  },
};

describe("buildSummary", () => {
  it("groups each change under its section with badge labels", () => {
    const out = buildSummary(input);
    expect(out).toContain('Changes to feature "checkout-flow":');
    expect(out).toContain("Default Value");
    expect(out).toContain("  - Edit default value");
    expect(out).toContain("Ramp Schedule – Spring rollout");
    expect(out).toContain("  - Start ramp: Spring rollout");
  });

  it("falls back to 'updated' for a section without badges", () => {
    const out = buildSummary({
      ...input,
      diffs: [{ title: "Settings", a: "x", b: "y" }],
    });
    expect(out).toContain("Settings");
    expect(out).toContain("  - updated");
  });

  it("handles an empty change set", () => {
    expect(buildSummary({ ...input, diffs: [] })).toBe(
      'No changes to feature "checkout-flow".',
    );
  });
});

describe("buildMinimalJsonDiff", () => {
  it("derives changes from the raw schema shapes, keyed by schema field", () => {
    const out = buildMinimalJsonDiff(input);
    const doc = JSON.parse(out);
    expect(doc.name).toBe("checkout-flow");
    expect(doc.type).toBe("feature");
    // Changes come from raw.before/raw.after (same input as the Raw JSON
    // render) — schema field names, not UI section titles.
    expect(doc.changes).toEqual([
      {
        field: "defaultValue",
        change: "modified",
        before: "false",
        after: "true",
      },
    ]);
    // Supplemental entities are separate top-level objects with the same
    // name/type pattern as the root.
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
    const out = buildMinimalJsonDiff({
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
    const doc = JSON.parse(out);
    // Pruned to the changed keys of the schema object.
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
    const out = buildMinimalJsonDiff({
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
    const doc = JSON.parse(out);
    const rules = doc.changes[0];
    expect(rules.field).toBe("rules");
    expect(rules.change).toBe("modified");
    // Added entries carry their index in the after array.
    expect(rules.items.added).toEqual([
      { index: 1, value: { id: "r3", type: "rollout", value: "C" } },
    ]);
    // Removed entries carry their index in the before array.
    expect(rules.items.removed).toEqual([
      { index: 1, value: { id: "r2", type: "force", value: "B" } },
    ]);
    // Modified entries are pruned to changed keys and carry both positions.
    expect(rules.items.modified).toEqual([
      {
        id: "r1",
        beforeIndex: 0,
        afterIndex: 0,
        before: { value: "A" },
        after: { value: "A2" },
      },
    ]);
    // Swapping in a new rule at the same slot is not a reorder.
    expect(rules.items.reordered).toBeUndefined();
    expect(rules.items.order).toBeUndefined();
  });

  it("flags reorders of surviving items and emits the new id order", () => {
    const out = buildMinimalJsonDiff({
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
    const items = JSON.parse(out).changes[0].items;
    expect(items.added).toEqual([]);
    expect(items.removed).toEqual([]);
    expect(items.modified).toEqual([]);
    expect(items.reordered).toBe(true);
    expect(items.order).toEqual(["r2", "r1"]);
  });

  it("does not flag a reorder when only insertions shift indices", () => {
    const out = buildMinimalJsonDiff({
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
    const items = JSON.parse(out).changes[0].items;
    expect(items.added).toEqual([
      { index: 0, value: { id: "r0", value: "Z" } },
    ]);
    expect(items.reordered).toBeUndefined();
  });

  it("prunes modified objects to their changed keys", () => {
    const out = buildMinimalJsonDiff({
      entityName: "f",
      diffs: [
        {
          title: "Settings",
          a: JSON.stringify({ keep: 1, change: "x" }),
          b: JSON.stringify({ keep: 1, change: "y" }),
        },
      ],
    });
    const doc = JSON.parse(out);
    expect(doc.changes[0]).toEqual({
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
});

describe("buildFullJson", () => {
  it("emits the root entity's whole before/after plus supplemental entities", () => {
    const out = buildFullJson(input);
    const doc = JSON.parse(out);
    // Same envelope as the minimal diff: root is the primary entity.
    expect(doc.name).toBe("checkout-flow");
    expect(doc.type).toBe("feature");
    expect(doc.before).toEqual({ defaultValue: "false", rules: [] });
    expect(doc.after).toEqual({ defaultValue: "true", rules: [] });
    // Supplemental ramp entity with empty "before" becomes null.
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
    const doc = JSON.parse(buildFullJson({ ...input, raw: undefined }));
    expect(doc.before).toBeUndefined();
    expect(doc.fields).toEqual([
      { name: "Default Value", before: false, after: true },
    ]);
    expect(
      doc.supplemental.map((e: { name: string; type: string }) => [
        e.name,
        e.type,
      ]),
    ).toEqual([["Spring rollout", "ramp-schedule"]]);
  });
});

describe("buildLLMDiff", () => {
  it("emits an XML diff plus the resulting state per entity", () => {
    const out = buildLLMDiff(input);
    expect(out).toContain('<change-set name="checkout-flow" type="feature">');
    expect(out).toContain("<summary>");
    expect(out).toContain("  - Default Value");
    // Tag named after the entity type, with the name as an attribute — the
    // same name/type pattern as the JSON formats.
    expect(out).toContain('<feature name="checkout-flow">');
    expect(out).toContain("<diff>");
    expect(out).toContain('-  "defaultValue": "false"');
    expect(out).toContain('+  "defaultValue": "true"');
    // The complete resulting object; the before-state is recoverable from
    // the diff, so it is omitted to keep the payload lean.
    expect(out).toContain("<after>");
    expect(out).toContain('"defaultValue": "true"');
    expect(out).not.toContain("<before>");
    expect(out).toContain("</feature>");
    expect(out).toContain('<ramp-schedule name="Spring rollout">');
    expect(out).toContain("</ramp-schedule>");
    expect(out).toContain("</change-set>");
  });
});

describe("formatDiffForCopy", () => {
  it("dispatches to the right formatter", () => {
    expect(formatDiffForCopy("formatted", input)).toBe(buildSummary(input));
    expect(formatDiffForCopy("minimal-json", input)).toBe(
      buildMinimalJsonDiff(input),
    );
    expect(formatDiffForCopy("full-json", input)).toBe(buildFullJson(input));
    expect(formatDiffForCopy("llm", input)).toBe(buildLLMDiff(input));
  });
});

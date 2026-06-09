import { describe, expect, it } from "vitest";
import {
  buildFullJson,
  buildLLMDiff,
  buildMinimalJsonDiff,
  buildSummary,
  formatDiffForCopy,
  type DiffCopyInput,
} from "@/components/Features/diffCopyFormats";

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
    expect(out).toContain('Changes to "checkout-flow":');
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
      'No changes to "checkout-flow".',
    );
  });
});

describe("buildMinimalJsonDiff", () => {
  it("emits a unified patch per changed field", () => {
    const out = buildMinimalJsonDiff(input);
    expect(out).toContain('Minimal JSON diff for "checkout-flow"');
    expect(out).toContain("--- Default Value\tbefore");
    expect(out).toContain("+++ Default Value\tafter");
    expect(out).toContain("-false");
    expect(out).toContain("+true");
  });
});

describe("buildFullJson", () => {
  it("emits the whole before/after object of the primary entity + supplementals", () => {
    const out = buildFullJson(input);
    expect(out).toContain('Full JSON for "checkout-flow"');
    expect(out).toContain("=== Feature revision ===");
    // Whole-object JSON, not just the changed field.
    expect(out).toContain('"defaultValue": "true"');
    expect(out).toContain('"rules": []');
    // Supplemental ramp entity with empty "before".
    expect(out).toContain("=== Ramp Schedule – Spring rollout ===");
    expect(out).toContain("(none)");
  });

  it("falls back to per-field entities when no whole shape is available", () => {
    const out = buildFullJson({ ...input, raw: undefined });
    expect(out).toContain("=== Default Value ===");
    expect(out).toContain("=== Ramp Schedule – Spring rollout ===");
  });
});

describe("buildLLMDiff", () => {
  it("diff-focused (default): XML diff per entity, no before/after blocks", () => {
    const out = buildLLMDiff(input);
    expect(out).toContain('<change-set entity="checkout-flow">');
    expect(out).toContain("<summary>");
    expect(out).toContain("  - Default Value");
    // PascalCase tag derived from the entity title, original kept as attribute.
    expect(out).toContain('<FeatureRevision title="Feature revision">');
    expect(out).toContain("<diff>");
    expect(out).toContain('-  "defaultValue": "false"');
    expect(out).toContain('+  "defaultValue": "true"');
    // Lean variant omits the full objects.
    expect(out).not.toContain("<before>");
    expect(out).not.toContain("<after>");
    expect(out).toContain("</FeatureRevision>");
    expect(out).toContain(
      '<RampScheduleSpringRollout title="Ramp Schedule – Spring rollout">',
    );
    expect(out).toContain("</change-set>");
  });

  it("full variant: includes diff + complete before/after objects", () => {
    const out = buildLLMDiff(input, { includeObjects: true });
    expect(out).toContain("<diff>");
    expect(out).toContain("<before>");
    expect(out).toContain("<after>");
    expect(out).toContain('"defaultValue": "true"');
  });
});

describe("formatDiffForCopy", () => {
  it("dispatches to the right formatter", () => {
    expect(formatDiffForCopy("formatted", input)).toBe(buildSummary(input));
    expect(formatDiffForCopy("minimal-json", input)).toBe(
      buildMinimalJsonDiff(input),
    );
    expect(formatDiffForCopy("full-json", input)).toBe(buildFullJson(input));
    expect(formatDiffForCopy("llm", input)).toBe(
      buildLLMDiff(input, { includeObjects: false }),
    );
    expect(formatDiffForCopy("llm-full", input)).toBe(
      buildLLMDiff(input, { includeObjects: true }),
    );
  });
});

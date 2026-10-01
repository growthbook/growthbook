import { format } from "date-fns";
import { FeatureRule } from "shared/types/feature";
import {
  buildVariationLabeler,
  groupAttributesByTargeting,
  matchesUsageRowFilter,
  toUsageRowFilters,
  targetingAttributeKeys,
  planStreamColumnWidths,
  planStreamTimestamps,
  ruleAbsenceNote,
  streamColumnLabel,
} from "@/components/Features/featureDiagnosticsStream";

describe("streamColumnLabel", () => {
  it("maps both spellings of known fields, case-insensitively", () => {
    expect(streamColumnLabel("ruleId")).toBe("Rule");
    expect(streamColumnLabel("rule_id")).toBe("Rule");
    expect(streamColumnLabel("RULE_ID")).toBe("Rule");
    expect(streamColumnLabel("variationId")).toBe("Variation");
    expect(streamColumnLabel("variation_id")).toBe("Variation");
    expect(streamColumnLabel("feature_key")).toBe("Feature");
    expect(streamColumnLabel("ENVIRONMENT")).toBe("Environment");
  });

  it("renders unknown columns as it always has", () => {
    expect(streamColumnLabel("unit_id")).toBe("Unit Id");
    expect(streamColumnLabel("reason")).toBe("Reason");
  });
});

describe("planStreamTimestamps", () => {
  const at = (iso: string) => ({ timestamp: iso });

  it("puts the month and day in every cell, even when rows share a day", () => {
    const plan = planStreamTimestamps([
      at("2026-09-28T13:23:45"),
      at("2026-09-28T09:02:11"),
    ]);
    const date = new Date("2026-09-28T13:23:45");
    expect(plan.format("2026-09-28T13:23:45", date)).toBe(
      `${format(date, "MMM d")}, ${format(date, "h:mm:ss a")}`,
    );
  });

  it("adds the year only across years", () => {
    const plan = planStreamTimestamps([
      at("2026-01-01T00:00:05"),
      at("2025-12-31T23:59:59"),
    ]);
    const date = new Date("2025-12-31T23:59:59");
    expect(plan.format("2025-12-31T23:59:59", date)).toBe(format(date, "PPpp"));
  });

  it("shows milliseconds only when the raw value has them", () => {
    const plan = planStreamTimestamps([at("2026-09-28T13:23:45.123")]);
    const date = new Date("2026-09-28T13:23:45.123");
    expect(plan.format("2026-09-28T13:23:45.123", date)).toContain(".123");
    expect(plan.format("2026-09-28T13:23:45", date)).not.toContain(".");
  });
});

describe("buildVariationLabeler", () => {
  const experiments = new Map([
    [
      "exp_1",
      {
        variations: [
          { key: "0", name: "Control" },
          { key: "1", name: "Treatment" },
        ],
      },
    ],
  ]);
  const label = buildVariationLabeler(
    [
      { id: "fr_exp", type: "experiment-ref", experimentId: "exp_1" },
      { id: "fr_safe__production", type: "safe-rollout" },
      { id: "fr_force", type: "force" },
    ] as FeatureRule[],
    experiments,
  );

  it("names the index from the current config, index first", () => {
    expect(label("fr_exp", "1")).toBe("(1) Treatment");
    expect(label("fr_safe", "0")).toBe("(0) Control");
  });

  it("shows the bare index with no match, never a guessed name", () => {
    expect(label("fr_exp", "2")).toBe("2");
    expect(label("fr_gone", "0")).toBe("0");
    expect(label("fr_force", "0")).toBe("0");
    expect(label("fr_exp", "")).toBe("");
  });
});

describe("ruleAbsenceNote", () => {
  it("explains the default value and rule-less results", () => {
    expect(ruleAbsenceNote("$default")).toMatch(/default value was served/);
    expect(ruleAbsenceNote("")).toBe("Served without a rule.");
    expect(ruleAbsenceNote("fr_abc")).toBeNull();
  });
});

describe("planStreamColumnWidths", () => {
  const label = (key: string) =>
    ({
      timestamp: "Timestamp",
      unit_id: "User ID",
      value: "Value",
      ruleId: "Rule",
      environment: "Environment",
    })[key] ?? key;
  const keys = ["timestamp", "unit_id", "value", "ruleId", "environment"];

  it("sizes to content within bounds, never below the header", () => {
    const widths = planStreamColumnWidths(
      keys,
      [
        {
          timestamp: "Sep 28, 1:23:45.123 PM",
          unit_id: "user_104829",
          value: "false",
          ruleId: "fr_abc",
          environment: "production",
        },
      ],
      label,
    );
    // Fixed at the format's widest, whatever the rows hold.
    expect(widths.timestamp).toBe(23);
    // Under each floor: User ID 14, Value 8, Rule 24.
    expect(widths.unit_id).toBe(14);
    expect(widths.value).toBe(8);
    expect(widths.ruleId).toBe(24);
    // "production" is 10 but the uppercase ENVIRONMENT header is wider.
    expect(widths.environment).toBeGreaterThan(10);
  });

  it("caps long values at the column's max", () => {
    const widths = planStreamColumnWidths(
      ["unit_id", "value", "ruleId"],
      [
        {
          unit_id: "x".repeat(60),
          value: '{"a":"' + "y".repeat(50) + '"}',
          ruleId: "r".repeat(80),
        },
      ],
      label,
    );
    expect(widths.unit_id).toBe(28);
    expect(widths.value).toBe(24);
    expect(widths.ruleId).toBe(48);
  });
});

describe("targetingAttributeKeys", () => {
  const rules = [
    {
      type: "force",
      allEnvironments: true,
      condition: JSON.stringify({
        country: { $in: ["US"] },
        $or: [{ plan: "pro" }],
      }),
    },
    {
      type: "force",
      allEnvironments: false,
      environments: ["staging"],
      condition: JSON.stringify({ employee: true }),
    },
    { type: "rollout", allEnvironments: true, condition: "" },
    { type: "force", allEnvironments: true, condition: "{not json" },
  ] as FeatureRule[];

  it("collects condition keys from rules in the row's environment", () => {
    expect(targetingAttributeKeys(rules, "production")).toEqual([
      "country",
      "plan",
    ]);
    expect(targetingAttributeKeys(rules, "staging")).toEqual([
      "country",
      "plan",
      "employee",
    ]);
  });
});

describe("groupAttributesByTargeting", () => {
  const attrs: [string, unknown][] = [
    ["id", "u1"],
    ["country", "US"],
    ["user", { plan: "pro" }],
    ["browser", "chrome"],
  ];

  it("splits by condition use, keeping SDK order, and lists absent keys", () => {
    expect(
      groupAttributesByTargeting(attrs, ["user.plan", "country", "loggedIn"]),
    ).toEqual({
      targeted: [
        ["country", "US"],
        ["user", { plan: "pro" }],
      ],
      absent: ["loggedIn"],
      other: [
        ["id", "u1"],
        ["browser", "chrome"],
      ],
    });
  });

  it("does not split when no condition references anything", () => {
    expect(groupAttributesByTargeting(attrs, [])).toBeNull();
  });
});

describe("toUsageRowFilters", () => {
  it("keeps applied filters and leaves half-built ones out", () => {
    expect(
      toUsageRowFilters([
        { column: "value", operator: "=", values: ["false"] },
        { column: "ruleId", operator: "is_null", values: [""] },
        { column: "source", operator: "in", values: [] },
        { operator: "=", values: ["x"] },
      ]),
    ).toEqual([
      { column: "value", operator: "=", values: ["false"] },
      { column: "ruleId", operator: "is_null", values: [] },
    ]);
  });
});

describe("matchesUsageRowFilter", () => {
  const f = (
    column: "value" | "ruleId",
    operator: Parameters<typeof matchesUsageRowFilter>[1]["operator"],
    values: string[] = [],
  ) => ({ column, operator, values });

  it("compares stored text, never coerced", () => {
    expect(matchesUsageRowFilter("false", f("value", "=", ["false"]))).toBe(
      true,
    );
    expect(
      matchesUsageRowFilter('{"a":1}', f("value", "contains", ['"a"'])),
    ).toBe(true);
  });

  it("treats an empty rule as null, as the server does", () => {
    expect(matchesUsageRowFilter("", f("ruleId", "is_null"))).toBe(true);
    expect(matchesUsageRowFilter("fr_a", f("ruleId", "is_null"))).toBe(false);
    expect(matchesUsageRowFilter("fr_a", f("ruleId", "not_null"))).toBe(true);
  });
});

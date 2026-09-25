import { format } from "date-fns";
import { FeatureRule } from "shared/types/feature";
import {
  buildVariationLabeler,
  planStreamTimestamps,
  ruleAbsenceNote,
  streamColumnLabel,
  timestampHeader,
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

  it("shows time only, with the date in the header, when every row shares a day", () => {
    const plan = planStreamTimestamps([
      at("2026-09-25T13:23:45"),
      at("2026-09-25T09:02:11"),
    ]);
    const date = new Date("2026-09-25T13:23:45");
    expect(plan.format("2026-09-25T13:23:45", date)).toBe(
      format(date, "h:mm:ss a"),
    );
    expect(plan.headerDate).toBe(format(date, "PP"));
    expect(timestampHeader(plan.headerDate)).toContain("Timestamp · ");
  });

  it("drops only the year across several days of one year", () => {
    const plan = planStreamTimestamps([
      at("2026-09-25T13:23:45"),
      at("2026-09-24T09:02:11"),
    ]);
    const date = new Date("2026-09-24T09:02:11");
    expect(plan.format("2026-09-24T09:02:11", date)).toBe(
      `${format(date, "MMM d")}, ${format(date, "h:mm:ss a")}`,
    );
    expect(plan.headerDate).toBeNull();
  });

  it("keeps the stream's original format across years", () => {
    const plan = planStreamTimestamps([
      at("2026-01-01T00:00:05"),
      at("2025-12-31T23:59:59"),
    ]);
    const date = new Date("2025-12-31T23:59:59");
    expect(plan.format("2025-12-31T23:59:59", date)).toBe(format(date, "PPpp"));
  });

  it("shows milliseconds only when the raw value has them", () => {
    const plan = planStreamTimestamps([at("2026-09-25T13:23:45.123")]);
    const date = new Date("2026-09-25T13:23:45.123");
    expect(plan.format("2026-09-25T13:23:45.123", date)).toContain(".123");
    expect(plan.format("2026-09-25T13:23:45", date)).not.toContain(".");
  });

  it("is wide enough for its longest timestamp", () => {
    const rows = [at("2025-12-31T23:59:59.999"), at("2026-01-01T00:00:00.000")];
    const plan = planStreamTimestamps(rows);
    const longest = Math.max(
      ...rows.map(
        (r) => plan.format(r.timestamp, new Date(r.timestamp)).length,
      ),
    );
    expect(plan.width).toBeGreaterThanOrEqual(Math.ceil(longest * 7.32) + 24);
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
    expect(label("fr_exp", "1")).toBe("1 · Treatment");
    expect(label("fr_safe", "0")).toBe("0 · Control");
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

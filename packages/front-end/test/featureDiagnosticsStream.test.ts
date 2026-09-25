import { format } from "date-fns";
import { FeatureInterface, FeatureRule } from "shared/types/feature";
import {
  flagShowsVariation,
  formatStreamTimestamp,
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

describe("flagShowsVariation", () => {
  const flag = (rules: Partial<FeatureRule>[]) =>
    ({
      rules: rules.map((r) => r as FeatureRule),
    }) as Pick<FeatureInterface, "rules">;

  it("is off with only force and rollout rules, whatever the value type", () => {
    expect(
      flagShowsVariation(flag([{ type: "force" }, { type: "rollout" }])),
    ).toBe(false);
  });

  it("is on for an experiment rule", () => {
    expect(flagShowsVariation(flag([{ type: "experiment-ref" }]))).toBe(true);
    expect(flagShowsVariation(flag([{ type: "experiment" }]))).toBe(true);
  });

  it("counts a safe rollout only while it is still an experiment", () => {
    const safe = (status: string) =>
      flag([{ type: "safe-rollout", status } as Partial<FeatureRule>]);
    expect(flagShowsVariation(safe("running"))).toBe(true);
    expect(flagShowsVariation(safe("released"))).toBe(false);
    expect(flagShowsVariation(safe("rolled-back"))).toBe(false);
  });
});

describe("formatStreamTimestamp", () => {
  it("keeps today's format when the data has no sub-second part", () => {
    const raw = "2026-09-25 13:23:45";
    const date = new Date("2026-09-25T13:23:45Z");
    expect(formatStreamTimestamp(raw, date)).toBe(format(date, "PPpp"));
    expect(formatStreamTimestamp(raw, date)).not.toContain(".000");
  });

  it("shows milliseconds when the data has them", () => {
    const date = new Date("2026-09-25T13:23:45.123Z");
    expect(formatStreamTimestamp("2026-09-25 13:23:45.123", date)).toContain(
      ".123",
    );
  });
});

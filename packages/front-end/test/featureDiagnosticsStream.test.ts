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
  const flag = (
    valueType: FeatureInterface["valueType"],
    types: FeatureRule["type"][],
  ) =>
    ({
      valueType,
      rules: types.map((type) => ({ type }) as FeatureRule),
    }) as Pick<FeatureInterface, "valueType" | "rules">;

  it("is off for a boolean flag with no experiment rule", () => {
    expect(flagShowsVariation(flag("boolean", ["force", "rollout"]))).toBe(
      false,
    );
  });

  it("is on for an experiment rule or a multivariate flag", () => {
    expect(flagShowsVariation(flag("boolean", ["experiment-ref"]))).toBe(true);
    expect(flagShowsVariation(flag("string", ["force"]))).toBe(true);
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

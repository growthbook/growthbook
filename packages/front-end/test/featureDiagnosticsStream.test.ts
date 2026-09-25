import { format } from "date-fns";
import {
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

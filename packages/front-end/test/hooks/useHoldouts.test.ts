import { setupI18n } from "@lingui/core";
import { holdoutSizeTip, holdoutStatusLabel } from "@/hooks/useHoldouts";
import { messages } from "@/locales/en/messages.po";

const i18n = setupI18n({ locale: "en", messages: { en: messages } });

describe("holdoutStatusLabel", () => {
  it.each([
    ["draft", null, "Draft"],
    ["running", null, "Running"],
    ["running", "2026-01-01", "Running: Analysis Phase"],
    ["stopped", "2026-01-01", "Stopped"],
  ] as const)("%s with analysis start %s reads %s", (status, start, label) => {
    const holdout = { analysisStartDate: start ? new Date(start) : undefined };
    // English for search, and the same text translated for display.
    expect(holdoutStatusLabel(holdout, { status })).toBe(label);
    expect(holdoutStatusLabel(holdout, { status }, i18n)).toBe(label);
  });
});

describe("holdoutSizeTip", () => {
  it("splits held out, comparison and unmeasured", () => {
    expect(holdoutSizeTip(0.1, i18n)).toBe(
      "Of users the holdout targets, 10% are held out and never reach this experiment. Another 10% reach it as the holdout's comparison group, and the other 80% reach it unmeasured.",
    );
  });

  it("keeps fractional sizes", () => {
    const tip = holdoutSizeTip(0.025, i18n);
    expect(tip).toContain(", 2.5% are held out");
    expect(tip).toContain("the other 95% reach it unmeasured");
  });
});

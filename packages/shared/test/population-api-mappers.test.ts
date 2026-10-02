import {
  fromApiPopulationStep,
  fromApiPopulationWindowSettings,
  toApiPopulationStep,
  toApiPopulationWindowSettings,
} from "../src/validators/population";

describe("population API window/step mappers", () => {
  it("maps none <-> empty-string window type", () => {
    expect(
      fromApiPopulationWindowSettings({
        type: "none",
        delayValue: 0,
        delayUnit: "hours",
        windowValue: 72,
        windowUnit: "hours",
      }),
    ).toEqual({
      type: "",
      delayValue: 0,
      delayUnit: "hours",
      windowValue: 72,
      windowUnit: "hours",
    });

    expect(
      toApiPopulationWindowSettings({
        type: "",
        delayValue: 0,
        delayUnit: "hours",
        windowValue: 72,
        windowUnit: "hours",
      }),
    ).toEqual({
      type: "none",
      delayValue: 0,
      delayUnit: "hours",
      windowValue: 72,
      windowUnit: "hours",
    });
  });

  it("preserves conversion/lookback types through round-trip", () => {
    const apiStep = {
      source: { type: "factTable" as const, factTableId: "ft_123" },
      rowFilters: [
        { operator: "=" as const, column: "country", values: ["US"] },
      ],
      windowSettings: {
        type: "conversion" as const,
        delayValue: 1,
        delayUnit: "days" as const,
        windowValue: 7,
        windowUnit: "days" as const,
      },
    };

    const internal = fromApiPopulationStep(apiStep);
    expect(internal.windowSettings.type).toBe("conversion");
    expect(toApiPopulationStep(internal)).toEqual(apiStep);
  });
});

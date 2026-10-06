import type { PopulationStep } from "shared/validators";
import {
  getPopulationDateRange,
  getPopulationFactTableIds,
  getPopulationRuleViolations,
  getPopulationStepsLabel,
  getPopulationStepWindowLabel,
  type PopulationRuleFactTable,
} from "shared/populations";

function step(
  factTableId: string,
  windowType: PopulationStep["windowSettings"]["type"] = "",
): PopulationStep {
  return {
    source: { type: "factTable", factTableId },
    rowFilters: [],
    windowSettings: {
      type: windowType,
      delayValue: 0,
      delayUnit: "days",
      windowValue: 0,
      windowUnit: "days",
    },
  };
}

const events: PopulationRuleFactTable = {
  id: "ftb_events",
  datasource: "ds_main",
  userIdTypes: ["user_id", "anonymous_id"],
};
const orders: PopulationRuleFactTable = {
  id: "ftb_orders",
  datasource: "ds_main",
  userIdTypes: ["user_id"],
};
const otherWarehouse: PopulationRuleFactTable = {
  id: "ftb_other",
  datasource: "ds_other",
  userIdTypes: ["user_id"],
};

describe("getPopulationFactTableIds", () => {
  it("dedupes fact tables in first-seen order", () => {
    expect(
      getPopulationFactTableIds([
        step("ftb_orders"),
        step("ftb_events"),
        step("ftb_orders"),
      ]),
    ).toEqual(["ftb_orders", "ftb_events"]);
  });
});

describe("getPopulationDateRange", () => {
  const now = new Date("2026-10-06T15:30:00Z");

  it("includes today in day presets, starting at UTC midnight", () => {
    expect(getPopulationDateRange("last30Days", now)).toEqual({
      startDate: new Date("2026-09-07T00:00:00Z"),
      endDate: now,
    });
    expect(getPopulationDateRange("last90Days", now).startDate).toEqual(
      new Date("2026-07-09T00:00:00Z"),
    );
  });

  it("spans exactly 12 calendar months", () => {
    expect(getPopulationDateRange("last12Months", now).startDate).toEqual(
      new Date("2025-10-07T00:00:00Z"),
    );
  });
});

describe("getPopulationStepWindowLabel", () => {
  const settings = (
    overrides: Partial<PopulationStep["windowSettings"]>,
  ): PopulationStep["windowSettings"] => ({
    ...step("ftb_events").windowSettings,
    ...overrides,
  });

  it("returns an empty label when there is no window", () => {
    expect(getPopulationStepWindowLabel(settings({ type: "" }))).toBe("");
  });

  it("describes a lookback window", () => {
    expect(
      getPopulationStepWindowLabel(
        settings({ type: "lookback", windowValue: 30, windowUnit: "days" }),
      ),
    ).toBe("In the last 30 days");
  });

  it("describes a conversion window with singular units and a delay", () => {
    expect(
      getPopulationStepWindowLabel(
        settings({
          type: "conversion",
          windowValue: 1,
          windowUnit: "weeks",
          delayValue: 2,
          delayUnit: "hours",
        }),
      ),
    ).toBe("Within 1 week of the previous step, after a delay of 2 hours");
  });

  it("omits a zero delay", () => {
    expect(
      getPopulationStepWindowLabel(
        settings({ type: "conversion", windowValue: 7, windowUnit: "days" }),
      ),
    ).toBe("Within 7 days of the previous step");
  });
});

describe("getPopulationStepsLabel", () => {
  const names: Record<string, string> = {
    ftb_events: "Events",
    ftb_orders: "Orders",
  };
  const getName = (id: string) => names[id];

  it("joins step fact table names in order", () => {
    expect(
      getPopulationStepsLabel(
        [step("ftb_events"), step("ftb_orders"), step("ftb_events")],
        getName,
      ),
    ).toBe("Events → Orders → Events");
  });

  it("falls back to the fact table id when the name is unknown", () => {
    expect(
      getPopulationStepsLabel([step("ftb_events"), step("ftb_gone")], getName),
    ).toBe("Events → ftb_gone");
  });
});

describe("getPopulationRuleViolations", () => {
  it("accepts a valid multi-step population", () => {
    expect(
      getPopulationRuleViolations({
        datasource: "ds_main",
        userIdTypes: ["user_id"],
        steps: [
          step("ftb_events", "lookback"),
          step("ftb_orders", "conversion"),
        ],
        factTables: [events, orders],
      }),
    ).toEqual([]);
  });

  it("rejects a conversion window on the first step", () => {
    expect(
      getPopulationRuleViolations({
        datasource: "ds_main",
        userIdTypes: ["user_id"],
        steps: [step("ftb_events", "conversion")],
        factTables: [events],
      }),
    ).toEqual(["The first step cannot use a conversion window."]);
  });

  it("reports a fact table that was not found", () => {
    expect(
      getPopulationRuleViolations({
        datasource: "ds_main",
        userIdTypes: ["user_id"],
        steps: [step("ftb_missing")],
        factTables: [],
      }),
    ).toEqual(["Fact table ftb_missing not found."]);
  });

  it("reports a fact table from a different Data Source", () => {
    expect(
      getPopulationRuleViolations({
        datasource: "ds_main",
        userIdTypes: ["user_id"],
        steps: [step("ftb_other")],
        factTables: [otherWarehouse],
      }),
    ).toEqual(["Fact table ftb_other is not in Data Source ds_main."]);
  });

  it("lists every identifier type a fact table is missing", () => {
    expect(
      getPopulationRuleViolations({
        datasource: "ds_main",
        userIdTypes: ["user_id", "anonymous_id", "device_id"],
        steps: [step("ftb_orders")],
        factTables: [orders],
      }),
    ).toEqual([
      "Fact table ftb_orders does not support identifier types: anonymous_id, device_id.",
    ]);
  });

  it("reports a fact table used by several steps only once", () => {
    expect(
      getPopulationRuleViolations({
        datasource: "ds_main",
        userIdTypes: ["user_id"],
        steps: [step("ftb_missing"), step("ftb_missing")],
        factTables: [],
      }),
    ).toEqual(["Fact table ftb_missing not found."]);
  });

  it("returns every violation together", () => {
    expect(
      getPopulationRuleViolations({
        datasource: "ds_main",
        userIdTypes: ["anonymous_id"],
        steps: [
          step("ftb_events", "conversion"),
          step("ftb_orders"),
          step("ftb_other"),
        ],
        factTables: [events, orders, otherWarehouse],
      }),
    ).toEqual([
      "The first step cannot use a conversion window.",
      "Fact table ftb_orders does not support identifier types: anonymous_id.",
      "Fact table ftb_other is not in Data Source ds_main.",
    ]);
  });
});

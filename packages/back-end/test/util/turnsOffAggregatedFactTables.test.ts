import { AggregatedFactTableSettings } from "shared/types/fact-table";
import { turnsOffAggregatedFactTables } from "back-end/src/util/factTable";

const enabled: AggregatedFactTableSettings = {
  idTypes: ["user_id"],
  updateTime: { time: "03:00", timezone: "UTC" },
  lookbackWindow: 30,
};

describe("turnsOffAggregatedFactTables", () => {
  it("is true when null disables aggregation that is enabled", () => {
    expect(
      turnsOffAggregatedFactTables(
        { aggregatedFactTableSettings: enabled },
        { aggregatedFactTableSettings: null },
      ),
    ).toBe(true);
  });

  it("is false when the app sends null and aggregation is already off", () => {
    expect(
      turnsOffAggregatedFactTables(
        { aggregatedFactTableSettings: undefined },
        { aggregatedFactTableSettings: null },
      ),
    ).toBe(false);
  });

  it("is false when null is sent and the stored settings have no id types", () => {
    expect(
      turnsOffAggregatedFactTables(
        { aggregatedFactTableSettings: { ...enabled, idTypes: [] } },
        { aggregatedFactTableSettings: null },
      ),
    ).toBe(false);
  });

  it("is false when the update leaves the field out", () => {
    expect(
      turnsOffAggregatedFactTables(
        { aggregatedFactTableSettings: enabled },
        {},
      ),
    ).toBe(false);
    expect(
      turnsOffAggregatedFactTables(
        { aggregatedFactTableSettings: enabled },
        { aggregatedFactTableSettings: undefined },
      ),
    ).toBe(false);
  });

  it("is false when the update keeps aggregation on", () => {
    expect(
      turnsOffAggregatedFactTables(
        { aggregatedFactTableSettings: enabled },
        { aggregatedFactTableSettings: { ...enabled, lookbackWindow: 7 } },
      ),
    ).toBe(false);
  });
});

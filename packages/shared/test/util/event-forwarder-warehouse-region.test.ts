import { EventForwarderSinkType } from "shared/types/event-forwarder";
import {
  EVENT_FORWARDER_WAREHOUSE_AREAS,
  getGrowthBookRegionForWarehouseRegion,
  listEventForwarderWarehouseRegions,
} from "../../src/util/event-forwarder-warehouse-region";

const SINKS: EventForwarderSinkType[] = ["bigquery", "snowflake", "databricks"];

const EU_AREAS = new Set(["Europe", "India", "Middle East", "Africa"]);

describe("event forwarder warehouse regions", () => {
  it("maps a US cloud region onto us-east-1", () => {
    expect(
      getGrowthBookRegionForWarehouseRegion("databricks", "us-west-1"),
    ).toBe("us-east-1");
    expect(getGrowthBookRegionForWarehouseRegion("bigquery", "us-west1")).toBe(
      "us-east-1",
    );
    expect(
      getGrowthBookRegionForWarehouseRegion("snowflake", "us-west-2"),
    ).toBe("us-east-1");
  });

  it("maps a European cloud region onto eu-west-1", () => {
    expect(
      getGrowthBookRegionForWarehouseRegion("snowflake", "eu-central-1"),
    ).toBe("eu-west-1");
    expect(getGrowthBookRegionForWarehouseRegion("bigquery", "EU")).toBe(
      "eu-west-1",
    );
    expect(
      getGrowthBookRegionForWarehouseRegion("databricks", "westeurope"),
    ).toBe("eu-west-1");
  });

  it("returns null for a region the warehouse does not list", () => {
    expect(
      getGrowthBookRegionForWarehouseRegion("snowflake", "us-west-1"),
    ).toBe(null);
    expect(getGrowthBookRegionForWarehouseRegion("bigquery", "us-east-1")).toBe(
      null,
    );
  });

  it.each(SINKS)("keeps %s region ids unique and mapped by area", (sink) => {
    const regions = listEventForwarderWarehouseRegions(sink);
    const ids = regions.map((region) => region.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(regions.length).toBeGreaterThan(0);

    for (const region of regions) {
      expect(EVENT_FORWARDER_WAREHOUSE_AREAS).toContain(region.area);
      const expectsEu = EU_AREAS.has(region.area) || region.id === "EU";
      expect(region.growthBookRegion).toBe(
        expectsEu ? "eu-west-1" : "us-east-1",
      );
    }
  });
});

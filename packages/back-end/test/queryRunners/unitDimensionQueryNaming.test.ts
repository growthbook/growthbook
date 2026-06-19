import {
  buildUnitDimensionQueryMap,
  filterParentQueryMap,
  getUnitDimQueryName,
  parseUnitDimQueryName,
} from "back-end/src/queryRunners/unitDimensionQueryNaming";
import type { QueryMap } from "back-end/src/queryRunners/QueryRunner";

describe("unitDimensionQueryNaming", () => {
  it("parses unit-dimension query names", () => {
    expect(parseUnitDimQueryName("met_1")).toBeNull();
    expect(parseUnitDimQueryName("unitdim:dim_country:met_1")).toEqual({
      dimensionId: "dim_country",
      baseQueryName: "met_1",
    });
  });

  it("builds a query map for one unit dimension using bare query names", () => {
    const countryMetricQuery = { id: "qry_country_metric" };
    const browserMetricQuery = { id: "qry_browser_metric" };
    const countryGroupQuery = { id: "qry_country_group" };
    const parentMetricQuery = { id: "qry_parent_metric" };
    const queryMap: QueryMap = new Map([
      ["met_1", parentMetricQuery as never],
      [
        getUnitDimQueryName("dim_country", "met_1"),
        countryMetricQuery as never,
      ],
      [
        getUnitDimQueryName("dim_browser", "met_1"),
        browserMetricQuery as never,
      ],
      [
        getUnitDimQueryName("dim_country", "group_0"),
        countryGroupQuery as never,
      ],
    ]);

    const result = buildUnitDimensionQueryMap(queryMap, "dim_country");

    expect(Array.from(result.keys())).toEqual(["met_1", "group_0"]);
    expect(result.get("met_1")).toBe(countryMetricQuery);
    expect(result.get("group_0")).toBe(countryGroupQuery);
  });

  it("returns an empty map when no queries match the unit dimension", () => {
    const result = buildUnitDimensionQueryMap(new Map(), "dim_country");
    expect(result.size).toBe(0);
  });

  it("filterParentQueryMap drops unit-dimension queries but keeps parent queries", () => {
    const parentMetricQuery = { id: "qry_parent_metric" };
    const countryMetricQuery = { id: "qry_country_metric" };
    const queryMap: QueryMap = new Map([
      ["met_1", parentMetricQuery as never],
      [
        getUnitDimQueryName("dim_country", "met_1"),
        countryMetricQuery as never,
      ],
      [
        getUnitDimQueryName("dim_country", "group_0"),
        { id: "qry_country_group" } as never,
      ],
    ]);

    const result = filterParentQueryMap(queryMap);

    expect(Array.from(result.keys())).toEqual(["met_1"]);
    expect(result.get("met_1")).toBe(parentMetricQuery);
  });
});

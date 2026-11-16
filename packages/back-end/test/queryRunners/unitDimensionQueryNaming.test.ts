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

  it("round-trips dimension ids that contain a colon (experiment dimensions)", () => {
    // Cluster-experiment sub-unit dimensions keep their prefixed ids, e.g.
    // `exp:browser`. The base query name never contains a colon, so parsing must
    // split on the last colon to recover the full dimension id.
    for (const [dimensionId, baseQueryName] of [
      ["exp:browser", "group_0"],
      ["precomputed:region", "met_1"],
    ] as const) {
      const name = getUnitDimQueryName(dimensionId, baseQueryName);
      expect(parseUnitDimQueryName(name)).toEqual({
        dimensionId,
        baseQueryName,
      });
    }
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

  it("parent-pass filtering ignores isolated cluster sub-unit dimension queries", () => {
    // Cluster-experiment sub-unit dimensions are isolated under prefixed ids
    // (e.g. exp:browser). The parent/overall pass (both the inline
    // parseUnitDimQueryName skip in stats.ts and filterParentQueryMap) must drop
    // them so the dimensionless parent is never re-aggregated from a
    // dimension-bearing frame, while still being routable per dimension.
    const parentGroupQuery = { id: "qry_parent_group" };
    const browserGroupQuery = { id: "qry_browser_group" };
    const browserMetricQuery = { id: "qry_browser_metric" };
    const queryMap: QueryMap = new Map([
      ["group_0", parentGroupQuery as never],
      [
        getUnitDimQueryName("exp:browser", "group_0"),
        browserGroupQuery as never,
      ],
      [
        getUnitDimQueryName("exp:browser", "met_1"),
        browserMetricQuery as never,
      ],
    ]);

    // Parent pass keeps only the dimensionless parent query.
    expect(parseUnitDimQueryName("group_0")).toBeNull();
    expect(Array.from(filterParentQueryMap(queryMap).keys())).toEqual([
      "group_0",
    ]);

    // The isolated cluster-dimension queries are still routable per dimension.
    const browserMap = buildUnitDimensionQueryMap(queryMap, "exp:browser");
    expect(Array.from(browserMap.keys())).toEqual(["group_0", "met_1"]);
    expect(browserMap.get("group_0")).toBe(browserGroupQuery);
    expect(browserMap.get("met_1")).toBe(browserMetricQuery);
  });
});

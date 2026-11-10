import { getIsolatedDimensionIds } from "shared/experiments";
import type { DimensionForSnapshot } from "shared/types/experiment-snapshot";
import {
  getUnitDimQueryName,
  parseUnitDimQueryName,
  filterParentQueryMap,
} from "back-end/src/queryRunners/unitDimensionQueryNaming";
import type { QueryMap } from "back-end/src/queryRunners/QueryRunner";

// These tests assert the query SET that ExperimentResultsQueryRunner composes
// for cluster experiments, exercised through the same pure helpers the runner
// uses (getIsolatedDimensionIds for the parent/isolated split, getUnitDimQueryName
// for naming, filterParentQueryMap for the parent pass). The runner itself is
// orchestration (not unit-tested per the repo testing policy); this pins the
// decision logic that determines which queries it emits.
//
// Runner behavior being pinned (ExperimentResultsQueryRunner.runAnalysisQueries):
//   - parentSnapshotDimensions = snapshot dimensions MINUS the isolated set,
//     so the parent metric queries are dimensionless for cluster experiments.
//   - isolatedSnapshotDimensions = the isolated set; each emits one query per
//     metric group, named with getUnitDimQueryName (the `unitdim:` prefix).
//   - the parent gbstats pass uses filterParentQueryMap, which drops those.

function splitDimensions(
  settings: Parameters<typeof getIsolatedDimensionIds>[0] & {
    dimensions: DimensionForSnapshot[];
  },
): { parent: DimensionForSnapshot[]; isolated: DimensionForSnapshot[] } {
  const isolated = new Set(getIsolatedDimensionIds(settings));
  return {
    parent: settings.dimensions.filter((d) => !isolated.has(d.id)),
    isolated: settings.dimensions.filter((d) => isolated.has(d.id)),
  };
}

describe("cluster experiment query-set composition", () => {
  const clusterSettings = {
    dimensions: [{ id: "exp:browser" }, { id: "exp:region" }],
    precomputedUnitDimensionIds: [],
    isClusterExperiment: true,
    clusterSubUnitIdentifier: "user_id",
  };

  it("splits a cluster snapshot into a dimensionless parent and isolated sub-unit dimensions", () => {
    const { parent, isolated } = splitDimensions(clusterSettings);

    // Parent is dimensionless; both sub-unit dimensions are isolated.
    expect(parent).toEqual([]);
    expect(isolated.map((d) => d.id)).toEqual(["exp:browser", "exp:region"]);
  });

  it("emits one dimensionless parent set plus one isolated set per sub-unit dimension", () => {
    const { isolated } = splitDimensions(clusterSettings);
    // Two metric groups, as the runner would produce for the parent.
    const metricGroupNames = ["group_0", "group_1"];

    const queryMap: QueryMap = new Map();
    metricGroupNames.forEach((name) =>
      queryMap.set(name, { id: `qry_parent_${name}` } as never),
    );
    isolated.forEach((d) =>
      metricGroupNames.forEach((name) =>
        queryMap.set(getUnitDimQueryName(d.id, name), {
          id: `qry_${d.id}_${name}`,
        } as never),
      ),
    );

    // 2 parent group queries + 2 dimensions * 2 groups = 6 total.
    expect(queryMap.size).toBe(6);

    // The parent gbstats pass sees only the dimensionless parent queries.
    expect(Array.from(filterParentQueryMap(queryMap).keys())).toEqual([
      "group_0",
      "group_1",
    ]);

    // Each isolated dimension round-trips to its prefixed query names.
    const browserNames = Array.from(queryMap.keys()).filter(
      (k) => parseUnitDimQueryName(k)?.dimensionId === "exp:browser",
    );
    expect(browserNames).toEqual([
      getUnitDimQueryName("exp:browser", "group_0"),
      getUnitDimQueryName("exp:browser", "group_1"),
    ]);
  });

  it("leaves non-cluster snapshots combined (no isolated sub-unit dimensions)", () => {
    const nonClusterSettings = {
      ...clusterSettings,
      isClusterExperiment: false,
      clusterSubUnitIdentifier: undefined,
    };

    const { parent, isolated } = splitDimensions(nonClusterSettings);

    // Nothing is isolated, so all dimensions stay on the combined parent query
    // (the existing combine-then-reaggregate path, unchanged for user-level
    // experiments).
    expect(isolated).toEqual([]);
    expect(parent.map((d) => d.id)).toEqual(["exp:browser", "exp:region"]);
  });

  it("isolates precomputed unit dimensions even without a cluster sub-unit", () => {
    // Precomputed unit dimensions are always isolated (pre-existing behavior),
    // independent of cluster experiments.
    const unitDimSettings = {
      dimensions: [] as DimensionForSnapshot[],
      precomputedUnitDimensionIds: ["dim_country"],
      isClusterExperiment: false,
      clusterSubUnitIdentifier: undefined,
    };

    expect(getIsolatedDimensionIds(unitDimSettings)).toEqual(["dim_country"]);
  });
});

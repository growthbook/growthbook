import type { QueryMap } from "back-end/src/queryRunners/QueryRunner";

// Pre-computed unit-dimension metric Queries are named with this prefix.
//
// Because they are not part of the parent snapshot's dimensionless analysis,
// but the data lives in the parent snapshot's `queries` array, we namespace
// them with this prefix for retrieval.
//
// Also used by the parent analysis to filter out these queries from its own analysis.
export const UNIT_DIM_QUERY_PREFIX = "unitdim:";

export function getUnitDimQueryName(
  dimensionId: string,
  baseQueryName: string,
): string {
  return `${UNIT_DIM_QUERY_PREFIX}${dimensionId}:${baseQueryName}`;
}

// Returns the dimensionId + original query name, or null if not a unit-dim
// query. Dimension ids (`dim_*`), metric ids (`met_*`/`fact__*`) and group
// names (`group_N`) never contain `:`, so splitting on the first two `:` is
// unambiguous.
export function parseUnitDimQueryName(
  name: string,
): { dimensionId: string; baseQueryName: string } | null {
  if (!name.startsWith(UNIT_DIM_QUERY_PREFIX)) return null;
  const rest = name.slice(UNIT_DIM_QUERY_PREFIX.length);
  const sep = rest.indexOf(":");
  if (sep < 0) return null;
  return {
    dimensionId: rest.slice(0, sep),
    baseQueryName: rest.slice(sep + 1),
  };
}

// Returns a queryMap rewritten to bare metric keys for the given unit
// dimension. An empty map means no `unitdim:<id>:` queries existed on the
// parent snapshot — callers must treat this as "stale snapshot, refresh
// required" rather than feeding gbstats an empty query set.
export function buildUnitDimensionQueryMap(
  queryMap: QueryMap,
  dimensionId: string,
): QueryMap {
  const unitDimensionQueryMap: QueryMap = new Map();

  queryMap.forEach((query, name) => {
    const parsed = parseUnitDimQueryName(name);
    if (parsed?.dimensionId === dimensionId) {
      unitDimensionQueryMap.set(parsed.baseQueryName, query);
    }
  });

  return unitDimensionQueryMap;
}

/** Query map for the parent snapshot's dimensionless gbstats pass. */
export function filterParentQueryMap(queryMap: QueryMap): QueryMap {
  const parentQueryMap: QueryMap = new Map();
  queryMap.forEach((query, name) => {
    if (!parseUnitDimQueryName(name)) {
      parentQueryMap.set(name, query);
    }
  });
  return parentQueryMap;
}

// Per-unit-dimension metric queries live on the parent snapshot's `queries`
// array but must NOT be consumed by the parent's own analysis. They are
// namespaced with this prefix so the parent analysis can filter them out and
// the post-success derive hook can recover the original (metricId / group_N)
// query name for each dimension.
//
// Kept in its own dependency-free module so the derive hook can import the
// name codec without pulling in the full query-runner / SQL-integration graph.
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

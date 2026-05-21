import { isContextualBanditAttrColumn } from "shared/experiments";
import type { DimensionColumnData } from "shared/types/integrations";

/**
 * For contextual bandits, period weights are pooled across attr_cb_* slices.
 * Otherwise weights are computed per full dimension tuple.
 */
export function getBanditPeriodWeightDimensionCols(
  dimensionCols: DimensionColumnData[],
): DimensionColumnData[] {
  const withoutContextualAttrs = dimensionCols.filter(
    (d) => !isContextualBanditAttrColumn(d.alias),
  );
  return withoutContextualAttrs.length < dimensionCols.length
    ? withoutContextualAttrs
    : dimensionCols;
}

export function banditDimensionJoinCondition(
  leftPrefix: string,
  rightPrefix: string,
  dimensionCols: DimensionColumnData[],
): string {
  if (!dimensionCols.length) {
    return "1=1";
  }
  return dimensionCols
    .map((d) => `${leftPrefix}.${d.alias} = ${rightPrefix}.${d.alias}`)
    .join(" AND ");
}

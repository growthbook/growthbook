import type {
  SnapshotBanditSettings,
  SnapshotSettingsVariation,
} from "shared/types/experiment-snapshot";
import type { VariationPeriodWeight } from "shared/types/integrations";

export function getBanditVariationPeriodWeights(
  banditSettings: SnapshotBanditSettings | undefined,
  variations: SnapshotSettingsVariation[],
): VariationPeriodWeight[] | undefined {
  const historicalWeights = banditSettings?.historicalWeights;
  if (!Array.isArray(historicalWeights) || historicalWeights.length === 0) {
    return undefined;
  }

  const variationPeriodWeights: VariationPeriodWeight[] = [];
  for (const period of historicalWeights) {
    if (!Array.isArray(period?.weights)) {
      return undefined;
    }
    const date = new Date(period.date);
    if (Number.isNaN(date.getTime())) {
      return undefined;
    }

    for (const [index, weight] of period.weights.entries()) {
      const variationId = variations?.[index]?.id;
      if (!variationId || typeof weight !== "number" || Number.isNaN(weight)) {
        return undefined;
      }
      variationPeriodWeights.push({ weight, variationId, date });
    }
  }

  return variationPeriodWeights.length > 0 ? variationPeriodWeights : undefined;
}

export function getBanditDates(
  banditSettings: SnapshotBanditSettings | undefined,
): Date[] | undefined {
  if (banditSettings?.contextualBandit) {
    return undefined;
  }
  const historicalWeights = banditSettings?.historicalWeights;
  if (!Array.isArray(historicalWeights) || historicalWeights.length === 0) {
    return undefined;
  }

  const dates: Date[] = [];
  for (const period of historicalWeights) {
    const date = new Date(period.date);
    if (Number.isNaN(date.getTime())) {
      return undefined;
    }
    dates.push(date);
  }

  return dates.length > 0 ? dates : undefined;
}

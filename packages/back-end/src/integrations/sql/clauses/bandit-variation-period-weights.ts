import type {
  SnapshotBanditSettings,
  SnapshotSettingsVariation,
} from "shared/types/experiment-snapshot";
import type { VariationPeriodWeight } from "shared/types/integrations";

export function getBanditVariationPeriodWeights(
  banditSettings: SnapshotBanditSettings,
  variations: SnapshotSettingsVariation[],
): VariationPeriodWeight[] | undefined {
  let anyMissingValues = false;
  const variationPeriodWeights = banditSettings.historicalWeights
    .map((w) => {
      return w.weights.map((weight, index) => {
        const variationId = variations?.[index]?.id;
        if (!variationId) {
          anyMissingValues = true;
        }
        return { weight, variationId: variationId, date: w.date };
      });
    })
    .flat();

  if (anyMissingValues) {
    return undefined;
  }

  return variationPeriodWeights;
}

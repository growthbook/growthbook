import { GrowthBook } from "@growthbook/growthbook";
import type {
  Attributes,
  Context,
  FeatureDefinition,
} from "@growthbook/growthbook";

export interface GrowthBookSSRData {
  attributes: Record<string, Attributes>;
  features: Record<string, FeatureDefinition>;
}

export async function getGrowthBookSSRData(
  context: Context
): Promise<GrowthBookSSRData> {
  // Server-side GrowthBook instance
  const gb = new GrowthBook({
    ...context,
  });

  // Load feature flags from network if needed
  if (context.clientKey) {
    await gb.loadFeatures();
  }

  const data: GrowthBookSSRData = {
    attributes: gb.getAttributes(),
    features: gb.getFeatures(),
  };

  gb.destroy();

  return data;
}

import {
  GrowthBookFeatureClipboardFeature,
  GrowthBookFeatureClipboardPayload,
  growthbookFeatureClipboardPayload,
} from "shared/validators";
import { FeatureInterface } from "shared/types/feature";

export const FEATURE_CONFIGURATION_CLIPBOARD_VERSION = 1;

export function featureToClipboardConfiguration(
  feature: FeatureInterface,
): GrowthBookFeatureClipboardFeature {
  return {
    id: feature.id,
    description: feature.description,
    project: feature.project,
    valueType: feature.valueType,
    defaultValue: feature.defaultValue,
    tags: feature.tags,
    environmentSettings: feature.environmentSettings,
    rules: feature.rules ?? [],
    customFields: feature.customFields,
    jsonSchema: feature.jsonSchema,
    neverStale: feature.neverStale,
  };
}

export function buildFeatureConfigurationClipboardPayload(
  feature: FeatureInterface,
): string {
  const payload: GrowthBookFeatureClipboardPayload = {
    growthbook: {
      source: "growthbook",
      object: "feature",
      version: FEATURE_CONFIGURATION_CLIPBOARD_VERSION,
      exportedAt: new Date().toISOString(),
    },
    feature: featureToClipboardConfiguration(feature),
  };

  return JSON.stringify(payload, null, 2);
}

export function parseFeatureConfigurationClipboardPayload(
  text: string,
): GrowthBookFeatureClipboardPayload | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  const result = growthbookFeatureClipboardPayload.safeParse(parsed);
  return result.success ? result.data : null;
}

export const CONTEXTUAL_BANDIT_MEASUREMENT_ARM_TYPE =
  "contextualBanditMeasurementArm" as const;

export const CONTEXTUAL_BANDIT_MEASUREMENT_ARM_DEF_PREFIX = "$cbma:";

export const MEASUREMENT_ARM_CONTROL_VALUE = "control";
export const MEASUREMENT_ARM_BANDIT_VALUE = "bandit";
export const MEASUREMENT_ARM_GENPOP_VALUE = "genpop";

export function isContextualBanditMeasurementArm(exp: {
  type?: string | null;
}): boolean {
  return exp.type === CONTEXTUAL_BANDIT_MEASUREMENT_ARM_TYPE;
}

export function getContextualBanditMeasurementArmFeatureDefId(
  cbId: string,
): string {
  return `${CONTEXTUAL_BANDIT_MEASUREMENT_ARM_DEF_PREFIX}${cbId}`;
}

export function getContextualBanditMeasurementArmTrackingKey(
  cbTrackingKey: string,
): string {
  return `${cbTrackingKey}__measurement_arm`;
}

export function measurementArmWeights(percent: number): [number, number] {
  const p = Math.round(percent * 10000) / 10000;
  return [p, Math.round((1 - p) * 10000) / 10000];
}

/** Experiment fields the contextual bandit owns on its measurement-arm experiment. */
export const MEASUREMENT_ARM_CB_GOVERNED_FIELDS = [
  "name",
  "description",
  "tags",
  "project",
  "owner",
  "hashAttribute",
  "fallbackAttribute",
  "hashVersion",
  "disableStickyBucketing",
  "trackingKey",
  "datasource",
  "goalMetrics",
  "variations",
  "phases",
  "status",
  "archived",
  "excludeFromPayload",
  "type",
  "contextualBanditId",
  "hasVisualChangesets",
  "hasURLRedirects",
] as const;

import type {
  ContextualBanditInterface,
  ContextualBanditMeasurementArm,
} from "shared/validators";

export const CONTEXTUAL_BANDIT_MEASUREMENT_ARM_TYPE =
  "contextualBanditMeasurementArm" as const;

export const CONTEXTUAL_BANDIT_MEASUREMENT_ARM_DEF_PREFIX = "$cbma:";

export const MEASUREMENT_ARM_CONTROL_VALUE = "control";
export const MEASUREMENT_ARM_BANDIT_VALUE = "bandit";

export function isContextualBanditMeasurementArm(exp: {
  type?: string | null;
}): boolean {
  return exp.type === CONTEXTUAL_BANDIT_MEASUREMENT_ARM_TYPE;
}

export const MANAGED_EXPERIMENT_TYPES = [
  "holdout",
  CONTEXTUAL_BANDIT_MEASUREMENT_ARM_TYPE,
] as const;

export function isManagedExperiment(exp: { type?: string | null }): boolean {
  return (MANAGED_EXPERIMENT_TYPES as readonly string[]).includes(
    exp.type ?? "",
  );
}

export type ActiveMeasurementArm = ContextualBanditMeasurementArm & {
  experimentId: string;
};

export function getActiveMeasurementArm(
  cb: Pick<ContextualBanditInterface, "status" | "measurementArm">,
): ActiveMeasurementArm | null {
  const arm = cb.measurementArm;
  if (cb.status !== "running" || !arm?.enabled || !arm.experimentId) {
    return null;
  }
  return { ...arm, experimentId: arm.experimentId };
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

export const MEASUREMENT_ARM_EDITABLE_FIELDS = [
  "secondaryMetrics",
  "guardrailMetrics",
] as const;

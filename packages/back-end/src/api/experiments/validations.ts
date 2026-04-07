import type { CommercialFeature } from "shared/enterprise";
import { MetricOverride } from "shared/validators";
import { validateCustomFieldsForSection } from "back-end/src/util/custom-fields";
import { ApiReqContext } from "back-end/types/api";

export const validateCustomFields = async (
  customFieldValues: Record<string, unknown> | undefined,
  context: ApiReqContext,
  project?: string,
) => {
  await validateCustomFieldsForSection({
    customFieldValues,
    customFieldsModel: context.models.customFields,
    section: "experiment",
    project,
  });
};

type DecisionFrameworkPayload = {
  decisionCriteriaId?: string;
  decisionFrameworkMetricOverrides?: { id: string }[];
};

function decisionFrameworkPayloadIsNonEmpty(
  s: DecisionFrameworkPayload | undefined,
): boolean {
  if (!s) return false;
  return !!(
    s.decisionCriteriaId ||
    (s.decisionFrameworkMetricOverrides &&
      s.decisionFrameworkMetricOverrides.length > 0)
  );
}

function requireFeature(
  context: ApiReqContext,
  feature: CommercialFeature,
  message: string,
) {
  if (!context.hasPremiumFeature(feature)) {
    throw new Error(message);
  }
}

/**
 * Ensures create/update experiment payloads only use commercial features the org is licensed for.
 * Maps to {@link CommercialFeature} in license-consts (plan availability differs by tier).
 */
export function assertExperimentPayloadCommercialFeatures(
  context: ApiReqContext,
  payload: {
    postStratificationEnabled?: boolean | null;
    decisionFrameworkSettings?: DecisionFrameworkPayload;
    metricOverrides?: MetricOverride[];
    defaultDashboardId?: string;
  },
) {
  if (payload.postStratificationEnabled !== undefined) {
    requireFeature(
      context,
      "post-stratification",
      "postStratificationEnabled requires a higher tier plan.",
    );
  }

  if (decisionFrameworkPayloadIsNonEmpty(payload.decisionFrameworkSettings)) {
    requireFeature(
      context,
      "decision-framework",
      "decisionFrameworkSettings requires a higher tier plan.",
    );
  }

  if (payload.metricOverrides !== undefined) {
    requireFeature(
      context,
      "override-metrics",
      "metricOverrides requires a higher tier plan.",
    );
  }

  if (payload.defaultDashboardId !== undefined) {
    requireFeature(
      context,
      "dashboards",
      "defaultDashboardId requires a higher tier plan.",
    );
  }
}

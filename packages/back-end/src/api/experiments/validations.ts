import type { CommercialFeature } from "shared/enterprise";
import {
  ContextualBanditConfig,
  MetricOverride,
} from "shared/validators";
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

/**
 * Cross-resource validation for Contextual Bandit experiment payloads:
 *  - `cbaqId` resolves to a CBAQ in the same organization
 *  - every `contextualAttributes` column matches a non-deleted attribute on the CBAQ
 *  - `maxContexts × variations.length ≤ 3000`
 *
 * Single-goal / sticky-off / holdout=0 invariants are enforced at the model
 * layer in `validateContextualBanditInvariants`. They are only re-asserted
 * here when something the API layer must also reject (commercial gating).
 */
export async function assertContextualBanditPayload(
  context: ApiReqContext,
  payload: {
    isContextualBandit?: boolean;
    cbaqId?: string;
    contextualBanditConfig?: ContextualBanditConfig;
    variations?: { id?: string }[];
  },
) {
  if (!payload.isContextualBandit) return;

  requireFeature(
    context,
    "contextual-bandits",
    "isContextualBandit requires a higher tier plan.",
  );

  if (!payload.cbaqId) {
    throw new Error("cbaqId is required for contextual bandit experiments.");
  }

  const cbaq =
    await context.models.contextualBanditQueries.getById(payload.cbaqId);
  if (!cbaq) {
    throw new Error(`Unknown contextual bandit query: ${payload.cbaqId}`);
  }

  const cfg = payload.contextualBanditConfig;
  if (!cfg) {
    throw new Error(
      "contextualBanditConfig is required for contextual bandit experiments.",
    );
  }

  const liveAttributes = new Set(
    cbaq.attributes.filter((a) => !a.deleted).map((a) => a.column),
  );
  const missing = cfg.contextualAttributes.filter(
    (col) => !liveAttributes.has(col),
  );
  if (missing.length) {
    throw new Error(
      `Contextual attributes not found on CBAQ ${cbaq.id} (or soft-deleted): ${missing.join(", ")}`,
    );
  }

  const variationCount = payload.variations?.length ?? 0;
  if (variationCount > 0 && cfg.maxContexts * variationCount > 3000) {
    throw new Error(
      `maxContexts (${cfg.maxContexts}) × variations (${variationCount}) exceeds the hard cap of 3000.`,
    );
  }
}

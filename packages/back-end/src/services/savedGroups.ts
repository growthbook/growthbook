import { includeExperimentInPayload } from "shared/util";
import { ReqContext } from "back-end/types/organization";
import {
  getAllPayloadExperiments,
  getPayloadKeysForAllEnvs,
} from "back-end/src/models/ExperimentModel";
import { getAllFeatures } from "back-end/src/models/FeatureModel";
import { getAffectedSDKPayloadKeys } from "back-end/src/util/features";
import { SDKPayloadKey } from "back-end/types/sdk-payload";
import { ApiReqContext } from "back-end/types/api";
import { onSDKPayloadUpdate } from "./features";
import {
  getContextForAgendaJobByOrgObject,
  getEnvironmentIdsFromOrg,
} from "./organizations";

export async function savedGroupUpdated(
  baseContext: ReqContext | ApiReqContext,
  id: string,
) {
  // This is a background job, so create a new context with full read permissions
  const context = getContextForAgendaJobByOrgObject(baseContext.org);

  // Use a map to build a list of unique SDK payload keys
  const payloadKeys: Map<string, SDKPayloadKey> = new Map();
  const addKeys = (keys: SDKPayloadKey[]) =>
    keys.forEach((key) =>
      payloadKeys.set(key.environment + "<>" + key.project, key),
    );

  // Get all experiments using this saved group
  const experiments = await getAllPayloadExperiments(context);
  const savedGroupExperiments = Array.from(experiments.values()).filter(
    (exp) => {
      const phase = exp.phases[exp.phases.length - 1];
      if (!phase) return;

      if (phase.condition && phase.condition.includes(id)) return true;
      if (phase.savedGroups?.some((g) => g.ids.includes(id))) return true;

      return false;
    },
  );
  const expIds = new Set(savedGroupExperiments.map((exp) => exp.id));

  // Experiments using the visual editor affect all environments, so add those first
  addKeys(
    getPayloadKeysForAllEnvs(
      context,
      savedGroupExperiments
        .filter(
          (exp) =>
            includeExperimentInPayload(exp) &&
            (exp.hasVisualChangesets || exp.hasURLRedirects),
        )
        .map((exp) => exp.project || ""),
    ),
  );

  // Then, add in any feature flags using this saved group
  const allFeatures = await getAllFeatures(context);
  addKeys(
    getAffectedSDKPayloadKeys(
      allFeatures,
      getEnvironmentIdsFromOrg(context.org),
      (rule) =>
        (rule.type === "experiment-ref" && expIds.has(rule.experimentId)) ||
        (rule.condition && rule.condition.includes(id)) ||
        rule.savedGroups?.some((g) => g.ids.includes(id)),
    ),
  );

  await onSDKPayloadUpdate(context, Array.from(payloadKeys.values()));
}

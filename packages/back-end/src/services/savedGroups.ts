import { includeExperimentInPayload } from "shared/util";
import { ReadAccessFilter } from "shared/permissions";
import { OrganizationInterface } from "../../types/organization";
import {
  getAllPayloadExperiments,
  getPayloadKeysForAllEnvs,
} from "../models/ExperimentModel";
import { getAllFeatures } from "../models/FeatureModel";
import { getAffectedSDKPayloadKeys } from "../util/features";
import { SDKPayloadKey } from "../../types/sdk-payload";
import { refreshSDKPayloadCache } from "./features";
import { getEnvironmentIdsFromOrg } from "./organizations";

export async function savedGroupUpdated(
  org: OrganizationInterface,
  id: string,
  readAccessFilter: ReadAccessFilter
) {
  // Use a map to build a list of unique SDK payload keys
  const payloadKeys: Map<string, SDKPayloadKey> = new Map();
  const addKeys = (keys: SDKPayloadKey[]) =>
    keys.forEach((key) =>
      payloadKeys.set(key.environment + "<>" + key.project, key)
    );

  // Get all experiments using this saved group
  const experiments = await getAllPayloadExperiments(org.id);
  const savedGroupExperiments = Array.from(experiments.values()).filter(
    (exp) => {
      const phase = exp.phases[exp.phases.length - 1];
      if (!phase) return;

      if (phase.condition && phase.condition.includes(id)) return true;
      if (phase.savedGroups?.some((g) => g.ids.includes(id))) return true;

      return false;
    }
  );
  const expIds = new Set(savedGroupExperiments.map((exp) => exp.id));

  // Experiments using the visual editor affect all environments, so add those first
  addKeys(
    getPayloadKeysForAllEnvs(
      org,
      savedGroupExperiments
        .filter(
          (exp) => includeExperimentInPayload(exp) && exp.hasVisualChangesets
        )
        .map((exp) => exp.project || "")
    )
  );

  // Then, add in any feature flags using this saved group
  const allFeatures = await getAllFeatures(org.id, readAccessFilter);
  addKeys(
    getAffectedSDKPayloadKeys(
      allFeatures,
      getEnvironmentIdsFromOrg(org),
      (rule) =>
        (rule.type === "experiment-ref" && expIds.has(rule.experimentId)) ||
        (rule.condition && rule.condition.includes(id)) ||
        rule.savedGroups?.some((g) => g.ids.includes(id))
    )
  );

  await refreshSDKPayloadCache(
    org,
    Array.from(payloadKeys.values()),
    allFeatures,
    experiments
  );
}

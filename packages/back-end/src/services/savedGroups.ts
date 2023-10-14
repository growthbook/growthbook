import uniqBy from "lodash/uniqBy";
import { OrganizationInterface } from "../../types/organization";
import {
  getAllPayloadExperiments,
  getPayloadKeys,
} from "../models/ExperimentModel";
import { getAllFeatures } from "../models/FeatureModel";
import { getAffectedSDKPayloadKeys } from "../util/features";
import { refreshSDKPayloadCache } from "./features";

export async function savedGroupUpdated(
  org: OrganizationInterface,
  id: string
) {
  const allFeatures = await getAllFeatures(org.id);

  const payloadKeys = getAffectedSDKPayloadKeys(
    allFeatures,
    (rule) =>
      (rule.condition && rule.condition.includes(id)) ||
      rule.savedGroups?.some((g) => g.ids.includes(id))
  );

  const experiments = await getAllPayloadExperiments(org.id);
  Array.from(experiments.values())
    .filter((exp) => {
      const phase = exp.phases[exp.phases.length - 1];
      if (!phase) return;

      if (phase.condition && phase.condition.includes(id)) return true;
      if (phase.savedGroups?.some((g) => g.ids.includes(id))) return true;

      return false;
    })
    .forEach((exp) => {
      const keys = getPayloadKeys(org, exp, allFeatures);
      keys.forEach((key) => {
        payloadKeys.push(key);
      });
    });

  const uniqueKeys = uniqBy(
    payloadKeys,
    (key) => key.environment + "<>" + key.project
  );

  await refreshSDKPayloadCache(org, uniqueKeys, allFeatures, experiments);
}

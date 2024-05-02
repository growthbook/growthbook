import { ToggleFeatureResponse } from "../../../types/openapi";
import { getExperimentMapForFeature } from "../../models/ExperimentModel";
import {
  getFeature,
  toggleMultipleEnvironments,
} from "../../models/FeatureModel";
import { auditDetailsUpdate } from "../../services/audit";
import { getApiFeatureObj, getSavedGroupMap } from "../../services/features";
import { getEnvironmentIdsFromOrg } from "../../services/organizations";
import { createApiRequestHandler } from "../../util/handler";
import { toggleFeatureValidator } from "../../validators/openapi";

export const toggleFeature = createApiRequestHandler(toggleFeatureValidator)(
  async (req): Promise<ToggleFeatureResponse> => {
    const feature = await getFeature(req.context, req.params.id);
    if (!feature) {
      throw new Error("Could not find a feature with that key");
    }

    const environmentIds = getEnvironmentIdsFromOrg(req.organization);

    if (!req.context.permissions.canUpdateFeature(feature, {})) {
      req.context.permissions.throwPermissionError();
    }
    req.checkPermissions(
      "publishFeatures",
      feature.project,
      Object.keys(req.body.environments)
    );

    const toggles: Record<string, boolean> = {};
    Object.keys(req.body.environments).forEach((env) => {
      if (!environmentIds.includes(env)) {
        throw new Error(`Unknown environment: '${env}'`);
      }

      const state = [true, "true", "1", 1].includes(req.body.environments[env]);
      toggles[env] = state;
    });

    const updatedFeature = await toggleMultipleEnvironments(
      req.context,
      feature,
      toggles
    );

    if (updatedFeature !== feature) {
      await req.audit({
        event: "feature.toggle",
        entity: {
          object: "feature",
          id: feature.id,
        },
        details: auditDetailsUpdate(feature, updatedFeature),
        reason: req.body.reason,
      });
    }

    const groupMap = await getSavedGroupMap(req.organization);
    const experimentMap = await getExperimentMapForFeature(
      req.context,
      updatedFeature.id
    );
    return {
      feature: getApiFeatureObj({
        feature: updatedFeature,
        organization: req.organization,
        groupMap,
        experimentMap,
      }),
    };
  }
);

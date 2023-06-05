import { ToggleFeatureResponse } from "../../../types/openapi";
import {
  getFeature,
  toggleMultipleEnvironments,
} from "../../models/FeatureModel";
import { auditDetailsUpdate } from "../../services/audit";
import { getApiFeatureObj, getSavedGroupMap } from "../../services/features";
import { getEnvironments } from "../../services/organizations";
import { createApiRequestHandler } from "../../util/handler";
import { toggleFeatureValidator } from "../../validators/openapi";

export const toggleFeature = createApiRequestHandler(toggleFeatureValidator)(
  async (req): Promise<ToggleFeatureResponse> => {
    const feature = await getFeature(req.organization.id, req.params.id);
    if (!feature) {
      throw new Error("Could not find a feature with that key");
    }

    const environmentIds = new Set(
      getEnvironments(req.organization).map((e) => e.id)
    );

    req.checkPermissions("manageFeatures", feature.project);
    req.checkPermissions(
      "publishFeatures",
      feature.project,
      Object.keys(req.body.environments)
    );

    const toggles: Record<string, boolean> = {};
    Object.keys(req.body.environments).forEach((env) => {
      if (!environmentIds.has(env)) {
        throw new Error(`Unknown environment: '${env}'`);
      }

      const state = [true, "true", "1", 1].includes(req.body.environments[env]);
      toggles[env] = state;
    });

    const updatedFeature = await toggleMultipleEnvironments(
      req.organization,
      req.eventAudit,
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
    return {
      feature: getApiFeatureObj(updatedFeature, req.organization, groupMap),
    };
  }
);

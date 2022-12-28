import { z } from "zod";
import { ApiFeatureInterface } from "../../../types/api";
import {
  getFeature,
  toggleMultipleEnvironments,
} from "../../models/FeatureModel";
import { auditDetailsUpdate } from "../../services/audit";
import { getApiFeatureObj, getSavedGroupMap } from "../../services/features";
import { getEnvironments } from "../../services/organizations";
import { createApiRequestHandler } from "../../util/handler";

export const toggleFeature = createApiRequestHandler({
  paramsSchema: z
    .object({
      key: z.string(),
    })
    .strict(),
  bodySchema: z
    .object({
      environments: z.record(
        z.string(),
        z.union([
          z.boolean(),
          z.literal("true"),
          z.literal("false"),
          z.literal("1"),
          z.literal("0"),
          z.literal(""),
          z.literal(0),
          z.literal(1),
        ])
      ),
      reason: z.string().optional(),
    })
    .strict(),
})(
  async (req): Promise<{ feature: ApiFeatureInterface }> => {
    const feature = await getFeature(req.organization.id, req.params.key);
    if (!feature) {
      throw new Error("Could not find a feature with that key");
    }

    const environmentIds = new Set(
      getEnvironments(req.organization).map((e) => e.id)
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

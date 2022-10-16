import {
  ApiFeatureEnvironmentInterface,
  ApiFeatureInterface,
} from "../../../types/api";
import { getAllFeatures } from "../../models/FeatureModel";
import {
  getFeatureDefinition,
  getSavedGroupMap,
} from "../../services/features";
import { getEnvironments } from "../../services/organizations";
import { createApiRequestHandler } from "../../util/handler";

export const listFeatures = createApiRequestHandler<{
  features: ApiFeatureInterface[];
}>({
  handler: async (req) => {
    const features = await getAllFeatures(req.organization.id);
    const environments = getEnvironments(req.organization);
    const groupMap = await getSavedGroupMap(req.organization);

    return {
      features: features.map((feature) => {
        const featureEnvironments: Record<
          string,
          ApiFeatureEnvironmentInterface
        > = {};
        environments.forEach((env) => {
          const defaultValue = feature.defaultValue;
          const envSettings = feature.environmentSettings?.[env.id];
          const enabled = !!envSettings?.enabled;
          const rules = envSettings?.rules || [];
          const definition = getFeatureDefinition({
            feature,
            groupMap,
            environment: env.id,
          });

          const draft = feature.draft?.active
            ? {
                enabled,
                defaultValue: feature.draft?.defaultValue ?? defaultValue,
                rules: feature.draft?.rules?.[env.id] ?? rules,
                definition: getFeatureDefinition({
                  feature,
                  groupMap,
                  environment: env.id,
                  useDraft: true,
                }),
              }
            : null;

          featureEnvironments[env.id] = {
            defaultValue,
            enabled,
            rules,
            draft,
            definition,
          };
        });

        const featureRecord: ApiFeatureInterface = {
          archived: !!feature.archived,
          dateCreated: feature.dateCreated.toISOString(),
          dateUpdated: feature.dateUpdated.toISOString(),
          defaultValue: feature.defaultValue,
          description: feature.description || "",
          id: feature.id,
          environments: featureEnvironments,
          owner: feature.owner || "",
          project: feature.project || "",
          tags: feature.tags || [],
          valueType: feature.valueType,
          revision: {
            comment: feature.revision?.comment || "",
            date: (feature.revision?.date || feature.dateCreated).toISOString(),
            publishedBy: feature.revision?.publishedBy?.email || "",
            version: feature.revision?.version || 1,
          },
        };

        return featureRecord;
      }),
    };
  },
});

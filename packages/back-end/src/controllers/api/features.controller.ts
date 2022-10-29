import { z } from "zod";
import {
  ApiFeatureEnvironmentInterface,
  ApiFeatureInterface,
  ApiPaginationFields,
} from "../../../types/api";
import { getAllFeatures } from "../../models/FeatureModel";
import {
  getExpMap,
  getFeatureDefinition,
  getSavedGroupMap,
} from "../../services/features";
import { getEnvironments } from "../../services/organizations";
import { createApiRequestHandler } from "../../util/handler";

export const listFeatures = createApiRequestHandler({
  querySchema: z
    .object({
      limit: z.string().optional(),
      offset: z.string().optional(),
    })
    .strict(),
})(
  async (
    req
  ): Promise<ApiPaginationFields & { features: ApiFeatureInterface[] }> => {
    const features = await getAllFeatures(req.organization.id);
    const environments = getEnvironments(req.organization);
    const groupMap = await getSavedGroupMap(req.organization);

    // TODO: Move sorting/limiting to the database query for better performance
    const limit = parseInt(req.query.limit || "10");
    const offset = parseInt(req.query.offset || "0");
    if (isNaN(limit) || limit < 1 || limit > 100) {
      throw new Error("Pagination limit must be between 1 and 100");
    }
    if (isNaN(offset) || offset < 0 || offset >= features.length) {
      throw new Error("Invalid pagination offset");
    }

    const filtered = features
      .sort((a, b) => a.dateCreated.getTime() - b.dateCreated.getTime())
      .slice(offset, limit + offset);

    const nextOffset = offset + limit;
    const hasMore = nextOffset < features.length;

    const expMap = await getExpMap(req.organization.id, filtered);

    return {
      features: filtered.map((feature) => {
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
            expMap,
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
                  expMap,
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
          id: feature.id,
          description: feature.description || "",
          archived: !!feature.archived,
          dateCreated: feature.dateCreated.toISOString(),
          dateUpdated: feature.dateUpdated.toISOString(),
          defaultValue: feature.defaultValue,
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
      limit,
      offset,
      count: filtered.length,
      total: features.length,
      hasMore,
      nextOffset: hasMore ? nextOffset : null,
    };
  }
);

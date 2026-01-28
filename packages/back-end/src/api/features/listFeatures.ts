import { getConnectionSDKCapabilities } from "shared/sdk-versioning";
import { ListFeaturesResponse } from "shared/types/openapi";
import { listFeaturesValidator } from "shared/validators";
import { getFeatureRevisionsByFeaturesCurrentVersion } from "back-end/src/models/FeatureRevisionModel";
import { getAllPayloadExperiments } from "back-end/src/models/ExperimentModel";
import {
  getAllFeatures,
  getFeaturesPage,
  countFeatures,
} from "back-end/src/models/FeatureModel";
import {
  getApiFeatureObj,
  getSavedGroupMap,
  getFeatureDefinitions,
} from "back-end/src/services/features";
import {
  applyPagination,
  createApiRequestHandler,
  validatePagination,
} from "back-end/src/util/handler";
import { API_ALLOW_SKIP_PAGINATION } from "back-end/src/util/secrets";
import { findSDKConnectionByKey } from "back-end/src/models/SdkConnectionModel";

const emptyListResponse = (
  limit: number,
  offset: number,
): ListFeaturesResponse => ({
  features: [],
  limit,
  offset,
  count: 0,
  total: 0,
  hasMore: false,
  nextOffset: null,
});

export const listFeatures = createApiRequestHandler(listFeaturesValidator)(
  async (req): Promise<ListFeaturesResponse> => {
    const projectId = req.query.projectId;
    if (req.query.skipPagination && !API_ALLOW_SKIP_PAGINATION) {
      throw new Error(
        "skipPagination is not allowed. Set API_ALLOW_SKIP_PAGINATION=true in API environment variables. Self-hosted only.",
      );
    }
    const skipPagination = !!req.query.skipPagination;
    let limit: number;
    let offset: number;
    if (skipPagination) {
      limit = req.query.limit ?? 10;
      offset = req.query.offset ?? 0;
    } else {
      ({ limit, offset } = validatePagination(req.query));
    }

    // Resolve empty-result cases before loading groupMap/experimentMap
    if (
      projectId &&
      !req.context.permissions.canReadSingleProjectResource(projectId)
    ) {
      return emptyListResponse(limit, offset);
    }
    let projectIds: string[] | null = null;
    if (!projectId) {
      projectIds =
        req.context.permissions.getProjectsWithPermission("readData");
      if (projectIds !== null && projectIds.length === 0) {
        return emptyListResponse(limit, offset);
      }
    }

    const experimentScope = projectId ? [projectId] : (projectIds ?? undefined);
    const [groupMap, experimentMap] = await Promise.all([
      getSavedGroupMap(req.context),
      getAllPayloadExperiments(req.context, experimentScope),
    ]);

    let filtered: Awaited<ReturnType<typeof getFeaturesPage>>;
    let total: number;

    if (req.query.clientKey) {
      // clientKey: filter by SDK payload, then paginate in memory (or skip)
      const features = await getAllFeatures(req.context, {
        projects: projectId ? [projectId] : undefined,
        includeArchived: true,
      });
      const sdkConnection = await findSDKConnectionByKey(req.query.clientKey);
      if (
        !sdkConnection ||
        sdkConnection.organization !== req.organization.id
      ) {
        throw new Error("Invalid SDK connection key");
      }
      const payload = await getFeatureDefinitions({
        context: req.context,
        capabilities: getConnectionSDKCapabilities(sdkConnection),
        environment: sdkConnection.environment,
        projects: sdkConnection.projects,
        includeVisualExperiments: sdkConnection.includeVisualExperiments,
        includeDraftExperiments: sdkConnection.includeDraftExperiments,
        includeExperimentNames: sdkConnection.includeExperimentNames,
        includeRedirectExperiments: sdkConnection.includeRedirectExperiments,
        savedGroupReferencesEnabled: sdkConnection.savedGroupReferencesEnabled,
      });
      const filteredFeatures = features
        .filter((f) => f.id in payload.features)
        .sort(
          (a, b) =>
            a.dateCreated.getTime() - b.dateCreated.getTime() ||
            (a.id || "").localeCompare(b.id || ""),
        );
      if (skipPagination) {
        filtered = filteredFeatures;
        total = filteredFeatures.length;
      } else {
        const { filtered: page } = applyPagination(filteredFeatures, req.query);
        filtered = page;
        total = filteredFeatures.length;
      }
    } else if (projectId) {
      // projectId and can read
      if (skipPagination) {
        const features = await getAllFeatures(req.context, {
          projects: [projectId],
          includeArchived: true,
        });
        const sorted = features.sort(
          (a, b) =>
            a.dateCreated.getTime() - b.dateCreated.getTime() ||
            (a.id || "").localeCompare(b.id || ""),
        );
        filtered = sorted;
        total = sorted.length;
      } else {
        filtered = await getFeaturesPage(req.context, {
          project: projectId,
          includeArchived: true,
          limit,
          offset,
        });
        total = await countFeatures(req.context, {
          project: projectId,
          includeArchived: true,
        });
      }
    } else {
      // no projectId: projectIds already resolved above (or undefined = all org when global read)
      const projectsFilter = projectIds === null ? undefined : projectIds;
      if (skipPagination) {
        const features = await getAllFeatures(req.context, {
          projects: projectsFilter,
          includeArchived: true,
        });
        const sorted = features.sort(
          (a, b) =>
            a.dateCreated.getTime() - b.dateCreated.getTime() ||
            (a.id || "").localeCompare(b.id || ""),
        );
        filtered = sorted;
        total = sorted.length;
      } else {
        filtered = await getFeaturesPage(req.context, {
          projectIds: projectsFilter,
          includeArchived: true,
          limit,
          offset,
        });
        total = await countFeatures(req.context, {
          projectIds: projectsFilter,
          includeArchived: true,
        });
      }
    }

    const revisions = await getFeatureRevisionsByFeaturesCurrentVersion(
      req.context,
      filtered,
    );
    const safeRolloutMap =
      await req.context.models.safeRollout.getAllPayloadSafeRollouts();

    const hasMore = skipPagination ? false : offset + limit < total;
    const nextOffset = hasMore ? offset + limit : null;
    const outLimit = skipPagination ? total : limit;
    const outOffset = skipPagination ? 0 : offset;
    return {
      features: filtered.map((feature) => {
        const revision =
          revisions?.find(
            (r) => r.featureId === feature.id && r.version === feature.version,
          ) || null;
        return getApiFeatureObj({
          feature,
          organization: req.organization,
          groupMap,
          experimentMap,
          revision,
          safeRolloutMap,
        });
      }),
      limit: outLimit,
      offset: outOffset,
      count: filtered.length,
      total,
      hasMore,
      nextOffset,
    };
  },
);

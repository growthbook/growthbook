import { listFeaturesValidator } from "shared/validators";
import { stringToBoolean } from "shared/util";
import type { FeatureInterface, FeatureValueType } from "shared/types/feature";
import type { ApiReqContext } from "back-end/types/api";
import { getFeatureRevisionsByFeaturesCurrentVersion } from "back-end/src/models/FeatureRevisionModel";
import { getAllPayloadExperiments } from "back-end/src/models/ExperimentModel";
import {
  getAllFeatures,
  getFeaturesPage,
  countFeatures,
  FeatureSortFilter,
} from "back-end/src/models/FeatureModel";
import { splitCsv } from "back-end/src/services/experimentFilters";
import {
  getApiFeatureObj,
  getSavedGroupMap,
} from "back-end/src/services/features";
import {
  resolveOwnerEmails,
  resolveOwnerToUserId,
} from "back-end/src/services/owner";
import { getFeatureDefinitionsWithCache } from "back-end/src/controllers/features";
import {
  applyPagination,
  createApiRequestHandler,
  validatePagination,
} from "back-end/src/util/handler";
import { API_ALLOW_SKIP_PAGINATION } from "back-end/src/util/secrets";
import { findSDKConnectionByKey } from "back-end/src/models/SdkConnectionModel";

export const emptyListResponse = (limit: number, offset: number) => ({
  features: [] as never[],
  limit,
  offset,
  count: 0,
  total: 0,
  hasMore: false,
  nextOffset: null,
});

/**
 * Shared data-loading core for list-features. Builds the paginated feature
 * slice + every lookup the serializers need. Callers differ only in which
 * per-feature serializer (`getApiFeatureObj` vs `getApiFeatureObjV2`) they run
 * over the resulting slice.
 */
export async function loadFeaturesPage(
  context: ApiReqContext,
  organizationId: string,
  query: {
    projectId?: string;
    clientKey?: string;
    archived?: string | boolean;
    skipPagination?: string | boolean;
    limit?: number;
    offset?: number;
    // v2-only filter/sort params (the v1 validator rejects them)
    tag?: string;
    owner?: string;
    valueType?: string;
    baseConfig?: string;
    sortBy?: "id" | "dateCreated" | "dateUpdated";
    sortOrder?: "asc" | "desc";
  },
): Promise<
  | { empty: true; response: ReturnType<typeof emptyListResponse> }
  | {
      empty: false;
      filtered: Awaited<ReturnType<typeof getFeaturesPage>>;
      groupMap: Awaited<ReturnType<typeof getSavedGroupMap>>;
      experimentMap: Awaited<ReturnType<typeof getAllPayloadExperiments>>;
      revisions: Awaited<
        ReturnType<typeof getFeatureRevisionsByFeaturesCurrentVersion>
      >;
      safeRolloutMap: Awaited<
        ReturnType<
          ApiReqContext["models"]["safeRollout"]["getAllPayloadSafeRollouts"]
        >
      >;
      outLimit: number;
      outOffset: number;
      total: number;
      hasMore: boolean;
      nextOffset: number | null;
    }
> {
  const projectId = query.projectId;
  // Mirrors the internal `includeArchived` option: false (default) excludes
  // archived features; true includes them alongside non-archived ones.
  const includeArchived = stringToBoolean(query.archived?.toString()) ?? false;
  const skipPagination = stringToBoolean(query.skipPagination?.toString());

  // Owner values may be userIds (u_...) or emails. feature.owner stores a
  // userId on the modern write paths but legacy features can hold a raw name
  // or email, so match each token both as-given and resolved to a userId.
  const ownerTokens = splitCsv(query.owner);
  let owners: string[] | undefined;
  if (ownerTokens) {
    const candidates = new Set<string>(ownerTokens);
    for (const token of ownerTokens) {
      try {
        const resolved = await resolveOwnerToUserId(token, context);
        if (resolved) candidates.add(resolved);
      } catch {
        // Unknown u_ id — keep the raw token; a filter should return an
        // empty match, not an error
      }
    }
    owners = [...candidates];
  }

  // CSV filters — values within a param are ORed, params AND together. The
  // valueType tokens are enum-validated (case-insensitively) by the v2 query
  // schema; lowercase them so mixed-case input still matches the exact $in
  const filters = {
    tags: splitCsv(query.tag),
    owners,
    valueTypes: splitCsv(query.valueType)?.map(
      (v) => v.toLowerCase() as FeatureValueType,
    ),
    baseConfig: query.baseConfig || undefined,
  };

  const sortDir = query.sortOrder === "desc" ? -1 : 1;
  // Without sortBy, preserve each path's historical default order (insertion
  // order in the DB path, dateCreated ascending in the in-memory paths). With
  // sortBy, the _id tiebreak keeps ties stable across pages.
  const sort: FeatureSortFilter | undefined = query.sortBy
    ? { [query.sortBy]: sortDir, _id: 1 }
    : undefined;
  const sortInMemory = (features: FeatureInterface[]): FeatureInterface[] => {
    const sortBy = query.sortBy;
    if (!sortBy) {
      return features.sort(
        (a, b) => a.dateCreated.getTime() - b.dateCreated.getTime(),
      );
    }
    return features.sort((a, b) => {
      const av = a[sortBy];
      const bv = b[sortBy];
      const diff =
        av instanceof Date && bv instanceof Date
          ? av.getTime() - bv.getTime()
          : String(av) < String(bv)
            ? -1
            : String(av) > String(bv)
              ? 1
              : 0;
      return sortDir === -1 ? -diff : diff;
    });
  };
  if (skipPagination && !API_ALLOW_SKIP_PAGINATION) {
    throw new Error(
      "skipPagination is not allowed. Set API_ALLOW_SKIP_PAGINATION=true in API environment variables. Self-hosted only.",
    );
  }
  let limit: number;
  let offset: number;
  if (skipPagination) {
    limit = query.limit ?? 10;
    offset = query.offset ?? 0;
  } else {
    ({ limit, offset } = validatePagination(query));
  }

  // Resolve empty-result cases before loading groupMap/experimentMap
  if (
    projectId &&
    !context.permissions.canReadSingleProjectResource(projectId)
  ) {
    return { empty: true, response: emptyListResponse(limit, offset) };
  }
  let projectIds: string[] | null = null;
  if (!projectId) {
    projectIds = context.permissions.getProjectsWithPermission("readData");
    if (projectIds !== null && projectIds.length === 0) {
      return { empty: true, response: emptyListResponse(limit, offset) };
    }
  }

  const experimentScope = projectId ? [projectId] : (projectIds ?? undefined);
  const [groupMap, experimentMap] = await Promise.all([
    getSavedGroupMap(context),
    getAllPayloadExperiments(context, experimentScope),
  ]);

  let filtered: Awaited<ReturnType<typeof getFeaturesPage>>;
  let total: number;

  if (query.clientKey) {
    // clientKey: filter by SDK payload, then paginate in memory (or skip)
    const features = await getAllFeatures(context, {
      projects: projectId ? [projectId] : undefined,
      includeArchived,
      ...filters,
    });
    const sdkConnection = await findSDKConnectionByKey(query.clientKey);
    if (!sdkConnection || sdkConnection.organization !== organizationId) {
      throw new Error("Invalid SDK connection key");
    }
    const payload = await getFeatureDefinitionsWithCache({
      context: context,
      params: {
        ...sdkConnection,
        encryptPayload: false, // Force unencrypted for filtering
        encryptionKey: "", // Ensure no encryption
      },
    });
    const filteredFeatures = sortInMemory(
      features.filter((f) => f.id in payload.features),
    );
    if (skipPagination) {
      filtered = filteredFeatures;
      total = filteredFeatures.length;
    } else {
      const { filtered: page } = applyPagination(filteredFeatures, query);
      filtered = page;
      total = filteredFeatures.length;
    }
  } else if (projectId) {
    if (skipPagination) {
      const features = await getAllFeatures(context, {
        projects: [projectId],
        includeArchived,
        ...filters,
      });
      const sorted = sortInMemory(features);
      filtered = sorted;
      total = sorted.length;
    } else {
      filtered = await getFeaturesPage(context, {
        project: projectId,
        includeArchived,
        limit,
        offset,
        sort,
        ...filters,
      });
      total = await countFeatures(context, {
        project: projectId,
        includeArchived,
        ...filters,
      });
    }
  } else {
    const projectsFilter = projectIds === null ? undefined : projectIds;
    if (skipPagination) {
      const features = await getAllFeatures(context, {
        projects: projectsFilter,
        includeArchived,
        ...filters,
      });
      const sorted = sortInMemory(features);
      filtered = sorted;
      total = sorted.length;
    } else {
      filtered = await getFeaturesPage(context, {
        projectIds: projectsFilter,
        includeArchived,
        limit,
        offset,
        sort,
        ...filters,
      });
      total = await countFeatures(context, {
        projectIds: projectsFilter,
        includeArchived,
        ...filters,
      });
    }
  }

  const revisions = await getFeatureRevisionsByFeaturesCurrentVersion(
    context,
    filtered,
  );
  const safeRolloutMap =
    await context.models.safeRollout.getAllPayloadSafeRollouts();

  const hasMore = skipPagination ? false : offset + limit < total;
  const nextOffset = hasMore ? offset + limit : null;
  const outLimit = skipPagination ? total : limit;
  const outOffset = skipPagination ? 0 : offset;

  return {
    empty: false,
    filtered,
    groupMap,
    experimentMap,
    revisions,
    safeRolloutMap,
    outLimit,
    outOffset,
    total,
    hasMore,
    nextOffset,
  };
}

export const listFeatures = createApiRequestHandler(listFeaturesValidator)(
  async (req) => {
    const r = await loadFeaturesPage(
      req.context,
      req.organization.id,
      { ...req.query, archived: true }, // v1 always included archived features
    );
    if (r.empty) return r.response;
    return {
      features: await resolveOwnerEmails(
        r.filtered.map((feature) => {
          const revision =
            r.revisions?.find(
              (x) =>
                x.featureId === feature.id && x.version === feature.version,
            ) || null;
          return getApiFeatureObj({
            feature,
            organization: req.organization,
            groupMap: r.groupMap,
            experimentMap: r.experimentMap,
            revision,
            safeRolloutMap: r.safeRolloutMap,
          });
        }),
        req.context,
      ),
      limit: r.outLimit,
      offset: r.outOffset,
      count: r.filtered.length,
      total: r.total,
      hasMore: r.hasMore,
      nextOffset: r.nextOffset,
    };
  },
);

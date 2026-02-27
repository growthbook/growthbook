import { useEffect, useState, useMemo } from "react";
import { FeatureInterface, FeatureRule } from "shared/types/feature";
import { FeatureCodeRefsInterface } from "shared/types/code-refs";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { filterEnvironmentsByFeature, mergeRevision } from "shared/util";
import {
  SafeRolloutInterface,
  HoldoutInterface,
  MinimalFeatureRevisionInterface,
} from "shared/validators";
import useApi from "@/hooks/useApi";
import { useEnvironments } from "@/services/features";

type FeaturePageResponse = {
  feature: FeatureInterface | null;
  revisionList: MinimalFeatureRevisionInterface[];
  revisions: FeatureRevisionInterface[];
  experiments: ExperimentInterfaceStringDates[];
  safeRollouts: SafeRolloutInterface[];
  codeRefs: FeatureCodeRefsInterface[];
  holdout: HoldoutInterface | undefined;
};

function parseVersion(value: string | string[] | undefined): number | null {
  const v = Array.isArray(value) ? value[0] : value;
  if (!v) return null;
  const parsed = parseInt(v, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Build minimal revision for dropdown from a full revision (e.g. one fetched by version) */
function toMinimalRevision(
  r: FeatureRevisionInterface,
): MinimalFeatureRevisionInterface {
  return {
    version: r.version,
    datePublished: r.datePublished ?? null,
    dateUpdated: r.dateUpdated,
    createdBy: r.createdBy,
    status: r.status,
  };
}

/**
 * Handles efficient fetching of features and revisions for the Feature Page
 *
 * Features can be quite big in size, impacting load time, memory usage, and performance
 * on the page. So we fetch by default only the last 5 full revisions for a Feature.
 *
 * In addition, we fetch up to 200 'MinimalFeatureRevision' that gives us enough information to
 * render them in the UI but does not include rules.
 *
 * This hook controls the logic to automatically fetch additional full revisions if needed
 * and also caches them so we don't refetch when changing between the same 2 revisions.
 *
 */
export function useFeaturePageData(
  fid: string | string[] | undefined,
  versionQueryParam: string | string[] | undefined,
) {
  const [version, setVersion] = useState<number | null>(null);
  const forcedVersionFromQuery = useMemo(
    () => parseVersion(versionQueryParam),
    [versionQueryParam],
  );
  // null = latest available version. after the data is fetched, version gets updated.
  const selectedVersion = version ?? forcedVersionFromQuery;

  const [cachedRevisions, setCachedRevisions] = useState<
    Record<number, FeatureRevisionInterface>
  >({});

  const {
    data: baseData,
    error: baseError,
    mutate: mutateBase,
    isValidating: isValidatingBase,
  } = useApi<FeaturePageResponse>(fid ? `/feature/${fid}` : "", {
    shouldRun: () => !!fid,
  });

  // Only fetch a specific version if it isn't already in the base response or cache.
  const requestedVersionInBaseSet =
    baseData?.revisions?.some((r) => r.version === selectedVersion) ?? false;
  const requestedVersionInCache =
    selectedVersion != null && !!cachedRevisions[selectedVersion];
  const shouldFetchFromRevisionsEndpoint =
    !!fid &&
    selectedVersion != null &&
    !requestedVersionInBaseSet &&
    !requestedVersionInCache;

  const {
    data: selectedVersionRevisionsData,
    error: selectedVersionError,
    mutate: mutateSelectedVersion,
    isValidating: isValidatingSelectedVersion,
  } = useApi<{ status: 200; revisions: FeatureRevisionInterface[] }>(
    `/feature/${fid}/revisions?versions=${selectedVersion}`,
    {
      shouldRun: () => shouldFetchFromRevisionsEndpoint,
    },
  );

  // Clean up everything if fid changes
  useEffect(() => {
    setVersion(null);
    setCachedRevisions({});
  }, [fid]);

  const refreshData = async () => {
    await mutateBase();
    if (shouldFetchFromRevisionsEndpoint) {
      await mutateSelectedVersion();
    }
  };

  // Seed cache from the initial GET /feature/:id response
  useEffect(() => {
    if (!baseData || !baseData.feature || baseData.feature.id !== fid) {
      return;
    }

    setCachedRevisions((prev) => {
      const next = { ...prev };
      baseData.revisions.forEach((r) => {
        next[r.version] = r;
      });
      return next;
    });
  }, [baseData, fid]);

  // Append revisions fetched from GET /feature/:id/revisions?versions= (outside initial set)
  useEffect(() => {
    if (!selectedVersionRevisionsData?.revisions?.length || !fid) {
      return;
    }

    setCachedRevisions((prev) => {
      const next = { ...prev };
      selectedVersionRevisionsData.revisions.forEach((r) => {
        if (r.featureId === fid) next[r.version] = r;
      });
      return next;
    });
  }, [selectedVersionRevisionsData, fid]);

  // Merge base data with any on-demand cached revisions.
  const data = useMemo<FeaturePageResponse | undefined>(() => {
    if (!baseData) return undefined;

    const baseRevisionList = baseData.revisionList ?? [];
    const versionInList = new Set(baseRevisionList.map((r) => r.version));
    const extraMinimal = Object.values(cachedRevisions)
      .filter((r) => !versionInList.has(r.version))
      .map(toMinimalRevision);
    const revisionList = [...baseRevisionList, ...extraMinimal].sort(
      (a, b) => b.version - a.version,
    );

    return {
      ...baseData,
      revisionList,
      revisions: Object.values(cachedRevisions),
    };
  }, [baseData, cachedRevisions]);

  const baseFeature = data?.feature;
  const revisions = data?.revisions;
  const baseFeatureVersion = baseFeature?.version;

  // Set the initial selected version once data is available.
  // If there's a version in the URL query, use that. Otherwise, prefer an
  // active draft revision, falling back to the live (published) version.
  //
  // Wait until the revision cache is seeded before deciding: otherwise we run
  // with revisions=[] (cache not yet populated) and incorrectly set live.
  const hasRevisionsFromApi = (baseData?.revisions?.length ?? 0) > 0;
  const cacheSeeded =
    !!baseData &&
    !!baseFeatureVersion &&
    (!hasRevisionsFromApi || (revisions && revisions.length > 0));
  useEffect(() => {
    if (!baseFeatureVersion || version !== null) return;
    if (!cacheSeeded) return;

    if (forcedVersionFromQuery) {
      if (
        data?.revisionList &&
        data.revisionList.some((r) => r.version === forcedVersionFromQuery)
      ) {
        setVersion(forcedVersionFromQuery);
      }
      return;
    }

    // Search in revisionList (up to 200 minimal revisions) instead of revisions
    // (only 5 full revisions) to ensure we find drafts even if they're not in
    // the most recent 5 full revisions
    const draft =
      data?.revisionList &&
      data.revisionList.find(
        (r) =>
          r.status === "draft" ||
          r.status === "approved" ||
          r.status === "changes-requested" ||
          r.status === "pending-review",
      );
    setVersion(draft ? draft.version : baseFeatureVersion);
  }, [cacheSeeded, data, version, forcedVersionFromQuery, baseFeatureVersion]);

  const allEnvironments = useEnvironments();
  const environments = useMemo(
    () =>
      baseFeature
        ? filterEnvironmentsByFeature(allEnvironments, baseFeature)
        : [],
    [allEnvironments, baseFeature],
  );

  // If we are not seeing the live revision, we need to merge it with the current feature definition
  const revision = useMemo<FeatureRevisionInterface | null>(() => {
    if (!baseFeature) return null;

    const currentVersion = version ?? baseFeature.version ?? null;

    if (!currentVersion) return null;

    const match =
      revisions && revisions.find((r) => r.version === currentVersion);
    if (match) {
      return match;
    }

    // If we can't find the revision, create a dummy revision just so the page can render.
    // This is for old features that don't have any revision history saved.
    const rules: Record<string, FeatureRule[]> = {};
    environments.forEach((env) => {
      rules[env.id] = baseFeature.environmentSettings?.[env.id]?.rules || [];
    });
    return {
      baseVersion: baseFeature.version,
      comment: "",
      createdBy: null,
      dateCreated: baseFeature.dateCreated,
      datePublished: baseFeature.dateCreated,
      dateUpdated: baseFeature.dateUpdated,
      defaultValue: baseFeature.defaultValue,
      featureId: baseFeature.id,
      organization: baseFeature.organization,
      publishedBy: null,
      rules: rules,
      status: "published",
      version: baseFeature.version,
      prerequisites: baseFeature.prerequisites || [],
    };
  }, [revisions, version, environments, baseFeature]);

  const feature = useMemo(() => {
    if (!revision || !baseFeature) return null;
    return revision.version !== baseFeature.version
      ? mergeRevision(
          baseFeature,
          revision,
          environments.map((e) => e.id),
        )
      : baseFeature;
  }, [baseFeature, revision, environments]);

  const error = selectedVersionError ?? baseError;
  const isValidating = isValidatingBase || isValidatingSelectedVersion;

  return {
    data,
    error,
    isValidating,
    revisionLoading: isValidatingSelectedVersion,
    refreshData,
    feature,
    baseFeature: baseFeature ?? null,
    revision,
    environments,
    version,
    setVersion,
  };
}

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

// Build minimal revision from a full revision
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

// Fetches features and revisions. Loads 5 full revisions + 200 minimal revisions.
// Auto-fetches and caches additional full revisions as needed.
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

  // Seed cache from initial response
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

  // Append on-demand fetched revisions to cache
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

  // Set initial version: URL query > draft revision > live version.
  // Wait for cache to seed to avoid incorrectly selecting live when drafts exist.
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

    // Search revisionList (200 items) not revisions (5 items) to find all drafts
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

  const revision = useMemo<FeatureRevisionInterface | null>(() => {
    if (!baseFeature) return null;

    const currentVersion = version ?? baseFeature.version ?? null;

    if (!currentVersion) return null;

    const match =
      revisions && revisions.find((r) => r.version === currentVersion);
    if (match) {
      return match;
    }

    // Create dummy revision for old features without revision history
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

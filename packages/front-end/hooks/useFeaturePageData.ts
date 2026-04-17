import { useEffect, useRef, useState, useMemo } from "react";
import { FeatureInterface, FeatureRule } from "shared/types/feature";
import { FeatureCodeRefsInterface } from "shared/types/code-refs";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { filterEnvironmentsByFeature, mergeRevision } from "shared/util";
import {
  SafeRolloutInterface,
  HoldoutInterface,
  MinimalFeatureRevisionInterface,
  RampScheduleInterface,
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
  rampSchedules: RampScheduleInterface[];
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
    comment: r.comment || "",
    ...(r.title ? { title: r.title } : {}),
    ...(r.contributors?.length ? { contributors: r.contributors } : {}),
  };
}

// Fetches feature page data. Initial response includes full revisions for the top-5 recent,
// all active drafts, and their base versions. Auto-fetches and caches additional full revisions as needed.
export function useFeaturePageData(
  fid: string | string[] | undefined,
  versionQueryParam: string | string[] | undefined,
  userId?: string,
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

  // Poll ramp schedules independently so the timeline stays live without
  // reloading the full (heavy) feature page payload.
  const rampPollMs = 15_000;
  const { data: rampSchedulesData, mutate: mutateRampSchedules } = useApi<{
    status: 200;
    rampSchedules: RampScheduleInterface[];
  }>(fid ? `/ramp-schedule?featureId=${fid}` : "", {
    shouldRun: () => !!fid,
    refreshInterval: rampPollMs,
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

  // Also fetch the baseVersion of the currently-selected revision when it's
  // missing from the cache. This is needed for autoMerge (and thus the
  // publish/review CTAs) when the selected draft was based on an old revision
  // that fell outside the top-5 window returned by getLatestRevisions.
  const selectedRevisionBaseVersion: number | null = useMemo(() => {
    if (!selectedVersion) return null;
    const full =
      cachedRevisions[selectedVersion] ??
      baseData?.revisions?.find((r) => r.version === selectedVersion);
    return full?.baseVersion ?? null;
  }, [selectedVersion, cachedRevisions, baseData]);

  const baseVersionInCache =
    selectedRevisionBaseVersion != null &&
    !!cachedRevisions[selectedRevisionBaseVersion];
  const baseVersionInBaseSet =
    selectedRevisionBaseVersion != null &&
    (baseData?.revisions?.some(
      (r) => r.version === selectedRevisionBaseVersion,
    ) ??
      false);
  const shouldFetchBaseVersion =
    !!fid &&
    selectedRevisionBaseVersion != null &&
    !baseVersionInCache &&
    !baseVersionInBaseSet;

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

  const { data: baseVersionRevisionsData } = useApi<{
    status: 200;
    revisions: FeatureRevisionInterface[];
  }>(`/feature/${fid}/revisions?versions=${selectedRevisionBaseVersion}`, {
    shouldRun: () => shouldFetchBaseVersion,
  });

  // Clean up everything if fid changes
  useEffect(() => {
    setVersion(null);
    setCachedRevisions({});
  }, [fid]);

  const refreshData = async () => {
    await Promise.all([
      mutateBase(),
      mutateRampSchedules(),
      shouldFetchFromRevisionsEndpoint
        ? mutateSelectedVersion()
        : Promise.resolve(),
    ]);
  };

  // When the ramp-schedule poll detects an advancement (step or status change),
  // re-fetch the full feature payload so revisions and rule state stay in sync.
  const prevRampSchedulesRef = useRef<RampScheduleInterface[]>([]);
  useEffect(() => {
    const prev = prevRampSchedulesRef.current;
    const curr = rampSchedulesData?.rampSchedules ?? [];
    const hasAdvancement =
      prev.length > 0 &&
      curr.some((rs) => {
        const p = prev.find((r) => r.id === rs.id);
        return (
          p &&
          (rs.currentStepIndex !== p.currentStepIndex || rs.status !== p.status)
        );
      });
    prevRampSchedulesRef.current = curr;
    if (hasAdvancement) {
      mutateBase();
    }
  }, [rampSchedulesData]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Append base-version revision to cache when lazily fetched
  useEffect(() => {
    if (!baseVersionRevisionsData?.revisions?.length || !fid) {
      return;
    }

    setCachedRevisions((prev) => {
      const next = { ...prev };
      baseVersionRevisionsData.revisions.forEach((r) => {
        if (r.featureId === fid) next[r.version] = r;
      });
      return next;
    });
  }, [baseVersionRevisionsData, fid]);

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
      // Use polled ramp schedules when available so the timeline stays current
      // without requiring a full page reload.
      rampSchedules: rampSchedulesData?.rampSchedules ?? baseData.rampSchedules,
    };
  }, [baseData, cachedRevisions, rampSchedulesData]);

  const baseFeature = data?.feature;
  const revisions = data?.revisions;
  const baseFeatureVersion = baseFeature?.version;

  // When the live feature version increments (e.g. ramp auto-published above)
  // and the user was already viewing the live revision, snap them to the new live version.
  const versionRef = useRef(version);
  versionRef.current = version;
  const prevLiveVersionRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    const prevLive = prevLiveVersionRef.current;
    const newLive = baseFeatureVersion;
    prevLiveVersionRef.current = newLive ?? undefined;
    if (
      prevLive !== undefined &&
      newLive !== undefined &&
      newLive !== prevLive &&
      versionRef.current === prevLive
    ) {
      setVersion(newLive);
    }
  }, [baseFeatureVersion]);

  // Set initial version: URL query > own draft > live version.
  // Waits for cache to seed to avoid incorrectly selecting live when drafts exist.
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
        return;
      }
      // Invalid/unknown version — fall through to own draft/live default below.
    }

    // Prefer the user's own draft; if none, fall back to live.
    const isActiveDraft = (r: MinimalFeatureRevisionInterface) =>
      !(
        r.createdBy?.type === "system" &&
        r.createdBy.subtype === "ramp-schedule"
      ) &&
      (r.status === "draft" ||
        r.status === "approved" ||
        r.status === "changes-requested" ||
        r.status === "pending-review");

    const isMine = (r: MinimalFeatureRevisionInterface) =>
      !!userId &&
      (r.createdBy?.id === userId ||
        r.contributors?.some((c) => c?.id === userId));

    const drafts = data?.revisionList?.filter(isActiveDraft) ?? [];
    const myDraft = drafts.find(isMine) ?? null;

    setVersion(myDraft ? myDraft.version : baseFeatureVersion);
  }, [
    cacheSeeded,
    data,
    version,
    forcedVersionFromQuery,
    baseFeatureVersion,
    userId,
  ]);

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

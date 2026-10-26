import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { FeatureInterface, FeatureRule } from "shared/types/feature";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import {
  filterEnvironmentsByFeature,
  getFeaturePageDefaultVersion,
  mergeRevision,
} from "shared/util";
import {
  ACTIVE_DRAFT_STATUSES,
  SafeRolloutInterface,
  HoldoutInterface,
  MinimalFeatureRevisionInterface,
  RampScheduleInterface,
} from "shared/validators";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import { useEnvironments } from "@/services/features";

type FeaturePageResponse = {
  feature: FeatureInterface | null;
  revisionList: MinimalFeatureRevisionInterface[];
  revisions: FeatureRevisionInterface[];
  experiments: ExperimentInterfaceStringDates[];
  safeRollouts: SafeRolloutInterface[];
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
    baseVersion: r.baseVersion,
    datePublished: r.datePublished ?? null,
    dateUpdated: r.dateUpdated,
    createdBy: r.createdBy,
    status: r.status,
    comment: r.comment || "",
    ...(r.title ? { title: r.title } : {}),
    ...(r.contributors?.length ? { contributors: r.contributors } : {}),
  };
}

// Fetches feature page data. The initial response includes full revisions for
// live and the version the page opens on (with their bases); anything else is
// loaded into the same cache when needed.
export function useFeaturePageData(
  fid: string | string[] | undefined,
  versionQueryParam: string | string[] | undefined,
  userId?: string,
) {
  const [version, setVersionState] = useState<number | null>(null);
  // A version that was picked but hasn't loaded yet. The page keeps showing
  // the current one until it and its base have loaded, then switches at once.
  const [pendingVersion, setPendingVersion] = useState<number | null>(null);
  const forcedVersionFromQuery = useMemo(
    () => parseVersion(versionQueryParam),
    [versionQueryParam],
  );
  // null = latest available version. after the data is fetched, version gets updated.
  const selectedVersion = version ?? forcedVersionFromQuery;

  // The first request asks for a deep-linked version so it arrives with the
  // page. Fixed per flag: later switches load separately rather than changing
  // (and refetching) the main request.
  const initialVersion = useRef({
    fid: String(fid),
    v: forcedVersionFromQuery,
  });
  if (initialVersion.current.fid !== String(fid)) {
    initialVersion.current = { fid: String(fid), v: forcedVersionFromQuery };
  }

  const [cachedRevisions, setCachedRevisions] = useState<
    Record<number, FeatureRevisionInterface>
  >({});

  const {
    data: baseData,
    error: baseError,
    mutate: mutateBase,
    isValidating: isValidatingBase,
  } = useApi<FeaturePageResponse>(
    fid
      ? `/feature/${fid}${initialVersion.current.v !== null ? `?v=${initialVersion.current.v}` : ""}`
      : "",
    { shouldRun: () => !!fid },
  );

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

  const baseVersionOf = useCallback(
    (v: number): number | null => {
      const known =
        cachedRevisions[v]?.baseVersion ??
        baseData?.revisionList?.find((r) => r.version === v)?.baseVersion ??
        null;
      // Revisions are numbered from 1: a first revision's base of 0 means none
      return known !== null && known > 0 ? known : null;
    },
    [cachedRevisions, baseData],
  );

  // One loader for every full revision the page needs beyond the initial
  // response: the version on screen, and whatever modals or the compare view
  // ask for through the page context. All of it lands in the same cache.
  const { apiCall } = useAuth();
  const inFlight = useRef<Set<number>>(new Set());
  const [loadingVersions, setLoadingVersions] = useState<Set<number>>(
    new Set(),
  );
  // Versions the last load didn't return (gone, or the request failed)
  const [unavailableVersions, setUnavailableVersions] = useState<Set<number>>(
    new Set(),
  );
  const [loadError, setLoadError] = useState<Error | null>(null);
  const inBaseSet = useCallback(
    (v: number) => baseData?.revisions?.some((r) => r.version === v) ?? false,
    [baseData],
  );
  const loadedRef = useRef<(v: number) => boolean>(() => false);
  loadedRef.current = (v) => !!cachedRevisions[v] || inBaseSet(v);
  // Bumped when the page moves to another flag. A response or cleanup from an
  // earlier generation is ignored, even if the page has come back to that flag,
  // and a load asked for by a callback from an earlier flag doesn't start.
  const generation = useRef(0);
  const currentFid = useRef(fid);
  currentFid.current = fid;

  const loadRevisions = useCallback(
    async (versions: number[], { force = false } = {}) => {
      if (!fid || fid !== currentFid.current) return;
      const toFetch = [...new Set(versions)].filter(
        (v) =>
          v > 0 && !inFlight.current.has(v) && (force || !loadedRef.current(v)),
      );
      if (!toFetch.length) return;
      const update =
        (changed: number[], add: boolean) => (set: Set<number>) => {
          const next = new Set(set);
          changed.forEach((v) => (add ? next.add(v) : next.delete(v)));
          return next;
        };
      const gen = generation.current;
      toFetch.forEach((v) => inFlight.current.add(v));
      setLoadingVersions(update(toFetch, true));
      setUnavailableVersions(update(toFetch, false));
      try {
        const res = await apiCall<{ revisions: FeatureRevisionInterface[] }>(
          `/feature/${fid}/revisions?versions=${toFetch.join(",")}`,
        );
        if (gen !== generation.current) return;
        const returned = (res.revisions ?? []).filter(
          (r) => r.featureId === fid,
        );
        setCachedRevisions((prev) => {
          const next = { ...prev };
          returned.forEach((r) => {
            next[r.version] = r;
          });
          return next;
        });
        setUnavailableVersions(
          update(
            toFetch.filter((v) => !returned.some((r) => r.version === v)),
            true,
          ),
        );
        setLoadError(null);
      } catch (e) {
        if (gen !== generation.current) return;
        setUnavailableVersions(update(toFetch, true));
        setLoadError(e instanceof Error ? e : new Error(String(e)));
      } finally {
        if (gen === generation.current) {
          toFetch.forEach((v) => inFlight.current.delete(v));
          setLoadingVersions(update(toFetch, false));
        }
      }
    },
    [apiCall, fid],
  );

  // Clean up everything if fid changes (before anything loads for the new one)
  useEffect(() => {
    setVersionState(null);
    setPendingVersion(null);
    setCachedRevisions({});
    setUnavailableVersions(new Set());
    setLoadingVersions(new Set());
    inFlight.current = new Set();
    generation.current += 1;
  }, [fid]);

  // The version on screen (or about to be) and its base
  const targetVersion = pendingVersion ?? selectedVersion;
  const targetBaseVersion =
    targetVersion !== null ? baseVersionOf(targetVersion) : null;
  useEffect(() => {
    if (!baseData || targetVersion === null) return;
    void loadRevisions(
      targetBaseVersion !== null
        ? [targetVersion, targetBaseVersion]
        : [targetVersion],
    );
  }, [baseData, targetVersion, targetBaseVersion, loadRevisions]);

  // Also reloads what was loaded beyond the initial response and can still
  // change: the version on screen and any open drafts, so edits show up
  const refreshData = async () => {
    const changeable = Object.values(cachedRevisions)
      .filter(
        (r) =>
          !inBaseSet(r.version) &&
          (ACTIVE_DRAFT_STATUSES as readonly string[]).includes(r.status),
      )
      .map((r) => r.version);
    const onScreen = [targetVersion, targetBaseVersion].filter(
      (v): v is number => v !== null && !inBaseSet(v),
    );
    const reload = [...new Set([...onScreen, ...changeable])];
    await Promise.all([
      mutateBase(),
      mutateRampSchedules(),
      reload.length
        ? loadRevisions(reload, { force: true })
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

  const isReady = useCallback(
    (v: number) => {
      const loaded = (version: number) =>
        !!cachedRevisions[version] ||
        (baseData?.revisions?.some((r) => r.version === version) ?? false);
      const base = baseVersionOf(v);
      return loaded(v) && (base === null || loaded(base));
    },
    [cachedRevisions, baseData, baseVersionOf],
  );

  const setVersion = useCallback(
    (v: number) => {
      if (isReady(v)) {
        setVersionState(v);
        setPendingVersion(null);
      } else {
        setPendingVersion(v);
      }
    },
    [isReady],
  );

  // Switch to a picked version once it and its base have loaded, or give up
  // on one the server doesn't have
  useEffect(() => {
    if (pendingVersion === null) return;
    if (isReady(pendingVersion)) {
      setVersionState(pendingVersion);
      setPendingVersion(null);
    } else if (unavailableVersions.has(pendingVersion)) {
      setPendingVersion(null);
    }
  }, [pendingVersion, isReady, unavailableVersions]);

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
  }, [baseFeatureVersion, setVersion]);

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

    setVersion(
      getFeaturePageDefaultVersion({
        revisionList: data?.revisionList ?? [],
        liveVersion: baseFeatureVersion,
        requestedVersion: forcedVersionFromQuery,
        userId: userId ?? null,
      }),
    );
  }, [
    setVersion,
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

    // Nothing is on screen yet and the version the page opens on is still
    // loading: show nothing rather than live values under that version's URL
    if (version === null && pendingVersion !== null) return null;

    const currentVersion = version ?? baseFeature.version ?? null;

    if (!currentVersion) return null;

    const match =
      revisions && revisions.find((r) => r.version === currentVersion);
    if (match) {
      return match;
    }

    // A specific non-live version is selected but its revision has not loaded
    // yet (e.g. a ?v=N deep link outside the base response's full-revision
    // window). Do not fall back to live feature values under that version's
    // URL -- wait for the revision to load.
    if (currentVersion !== baseFeature.version) {
      return null;
    }

    // Create dummy revision for old features without revision history
    const rules: FeatureRule[] = baseFeature.rules ?? [];
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
  }, [revisions, version, pendingVersion, baseFeature]);

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

  // A failed load only blocks the page while there's nothing on screen yet
  const error = baseError ?? (version === null ? loadError : null) ?? undefined;
  const isValidating = isValidatingBase || loadingVersions.size > 0;

  return {
    data,
    error,
    isValidating,
    revisionLoading: pendingVersion !== null,
    refreshData,
    feature,
    baseFeature: baseFeature ?? null,
    revision,
    environments,
    // The version the page opens on reports as soon as it's picked; later
    // switches report once the new version has loaded
    version: version ?? pendingVersion,
    setVersion,
    loadRevisions,
    unavailableVersions,
  };
}

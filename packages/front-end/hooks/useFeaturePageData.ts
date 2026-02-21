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

/**
 * Handles efficient fetching of features and revisions for the Feature Page
 *
 * Features can be quite big in size, impacting load time, memory usage, and performance
 * on the page. So we fetch by default only the last 5 full revisions for a Feature.
 *
 * In addition, we fetch 25 'MinimalFeatureRevision' that gives us enough information to
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

  // We only fetch if we don't already have the full information
  // either on the base response or in the cache
  const shouldFetchSelectedVersion =
    fid !== undefined &&
    selectedVersion !== null &&
    !(
      (baseData?.revisions ?? []).some((r) => r.version === selectedVersion) ||
      !!cachedRevisions[selectedVersion]
    );

  const {
    data: selectedVersionData,
    error: selectedVersionError,
    mutate: mutateSelectedVersion,
    isValidating: isValidatingSelectedVersion,
  } = useApi<FeaturePageResponse>(
    fid && selectedVersion ? `/feature/${fid}?v=${selectedVersion}` : "",
    {
      shouldRun: () => shouldFetchSelectedVersion,
    },
  );

  // Clean up everything if fid changes
  useEffect(() => {
    setVersion(null);
    setCachedRevisions({});
  }, [fid]);

  const refreshData = async () => {
    await mutateBase();
    if (shouldFetchSelectedVersion) {
      await mutateSelectedVersion();
    }
  };

  // Cache revisions from the base response
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

  // Cache revisions from the version-specific response
  useEffect(() => {
    if (
      !selectedVersionData ||
      !selectedVersionData.feature ||
      selectedVersionData.feature.id !== fid
    ) {
      return;
    }

    setCachedRevisions((prev) => {
      const next = { ...prev };
      selectedVersionData.revisions.forEach((r) => {
        next[r.version] = r;
      });
      return next;
    });
  }, [selectedVersionData, fid]);

  // Create a composite response including all individually fetched revisions
  const data = useMemo<FeaturePageResponse | undefined>(() => {
    const source = baseData ?? selectedVersionData;
    if (!source) return undefined;

    return {
      ...source,
      revisions: Object.values(cachedRevisions),
    };
  }, [baseData, selectedVersionData, cachedRevisions]);

  const baseFeature = data?.feature;
  const revisions = data?.revisions;
  const baseFeatureVersion = baseFeature?.version;

  // Set the initial selected version once data is available.
  // If there's a version in the URL query, use that. Otherwise, prefer an
  // active draft revision, falling back to the live (published) version.
  useEffect(() => {
    if (!baseFeatureVersion || version !== null) return;

    if (forcedVersionFromQuery) {
      if (
        revisions &&
        revisions.some((r) => r.version === forcedVersionFromQuery)
      ) {
        setVersion(forcedVersionFromQuery);
      }
      return;
    }

    const draft =
      revisions &&
      revisions.find(
        (r) =>
          r.status === "draft" ||
          r.status === "approved" ||
          r.status === "changes-requested" ||
          r.status === "pending-review",
      );
    setVersion(draft ? draft.version : baseFeatureVersion);
  }, [revisions, version, forcedVersionFromQuery, baseFeatureVersion]);

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
    refreshData,
    feature,
    baseFeature: baseFeature ?? null,
    revision,
    environments,
    version,
    setVersion,
  };
}

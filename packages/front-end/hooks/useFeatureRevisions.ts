import { useEffect, useMemo } from "react";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import useApi from "@/hooks/useApi";
import { useFeatureRevisionsContext } from "@/contexts/FeatureRevisionsContext";

/**
 * Full revisions for the given versions. On the flag page they load into the
 * page's own cache, so a draft loaded here is there for the page and every
 * other caller; elsewhere they're fetched on their own. The flag page only
 * loads some drafts up front, so anything reading another draft goes through
 * here.
 */
export function useFeatureRevisions(
  featureId: string,
  versions: (number | null | undefined)[],
): {
  get: (
    version: number | null | undefined,
  ) => FeatureRevisionInterface | undefined;
  /** Any of the versions still loading */
  loading: boolean;
  isLoading: (version: number) => boolean;
  /** Not returned by the last load: gone, or the request failed */
  isUnavailable: (version: number) => boolean;
  retry: (versions: number[]) => void;
} {
  const ctx = useFeatureRevisionsContext();
  // The page rebuilds its context value every render; these parts are stable
  const onPage = !!ctx;
  const pageRevisions = ctx?.revisions;
  const pageUnavailable = ctx?.unavailableVersions;
  const wantedKey = [
    ...new Set(
      versions.filter((v): v is number => typeof v === "number" && v > 0),
    ),
  ]
    .sort((a, b) => a - b)
    .join(",");
  const missingKey = wantedKey
    .split(",")
    .filter((v) => v && !pageRevisions?.some((r) => r.version === Number(v)))
    .join(",");

  const loadRevisions = ctx?.loadRevisions;
  useEffect(() => {
    if (loadRevisions && missingKey) {
      void loadRevisions(missingKey.split(",").map(Number));
    }
  }, [loadRevisions, missingKey]);

  const { data, error, mutate } = useApi<{
    status: 200;
    revisions: FeatureRevisionInterface[];
  }>(`/feature/${featureId}/revisions?versions=${missingKey}`, {
    shouldRun: () => !onPage && !!featureId && !!missingKey,
  });

  return useMemo(() => {
    const byVersion = new Map<number, FeatureRevisionInterface>();
    data?.revisions?.forEach((r) => byVersion.set(r.version, r));
    pageRevisions?.forEach((r) => byVersion.set(r.version, r));
    const wanted = new Set(wantedKey.split(",").filter(Boolean).map(Number));

    const isUnavailable = (v: number) =>
      !byVersion.has(v) &&
      (onPage
        ? !!pageUnavailable?.has(v)
        : (!!data || !!error) && wanted.has(v));
    const isLoading = (v: number) =>
      wanted.has(v) && !byVersion.has(v) && !isUnavailable(v);

    return {
      get: (v) => (typeof v === "number" ? byVersion.get(v) : undefined),
      loading: [...wanted].some(isLoading),
      isLoading,
      isUnavailable,
      retry: (retryVersions) => {
        if (loadRevisions) void loadRevisions(retryVersions, { force: true });
        else void mutate();
      },
    };
  }, [
    onPage,
    pageRevisions,
    pageUnavailable,
    loadRevisions,
    data,
    error,
    mutate,
    wantedKey,
  ]);
}

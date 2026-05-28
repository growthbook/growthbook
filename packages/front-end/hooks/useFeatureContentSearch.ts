import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/services/auth";

export interface ContentSearchParams {
  valueContains?: string;
  attribute?: string;
  savedGroup?: string;
  prerequisite?: string;
  experiment?: string;
  bandit?: string;
}

const DEBOUNCE_MS = 300;

function paramsAreEmpty(params: ContentSearchParams): boolean {
  return (
    !params.valueContains &&
    !params.attribute &&
    !params.savedGroup &&
    !params.prerequisite &&
    !params.experiment &&
    !params.bandit
  );
}

function buildQueryString(params: ContentSearchParams): string {
  const parts: string[] = [];
  if (params.valueContains)
    parts.push(`valueContains=${encodeURIComponent(params.valueContains)}`);
  if (params.attribute)
    parts.push(`attribute=${encodeURIComponent(params.attribute)}`);
  if (params.savedGroup)
    parts.push(`savedGroup=${encodeURIComponent(params.savedGroup)}`);
  if (params.prerequisite)
    parts.push(`prerequisite=${encodeURIComponent(params.prerequisite)}`);
  if (params.experiment)
    parts.push(`experiment=${encodeURIComponent(params.experiment)}`);
  if (params.bandit) parts.push(`bandit=${encodeURIComponent(params.bandit)}`);
  return parts.join("&");
}

export interface UseFeatureContentSearchReturn {
  matchingIds: Set<string> | null;
  loading: boolean;
}

export function useFeatureContentSearch(
  params: ContentSearchParams,
): UseFeatureContentSearchReturn {
  const { apiCall } = useAuth();
  const [matchingIds, setMatchingIds] = useState<Set<string> | null>(null);
  const [loading, setLoading] = useState(false);
  const generationRef = useRef(0);
  const debounceTimer = useRef<ReturnType<typeof setTimeout>>();

  const doFetch = useCallback(
    async (p: ContentSearchParams) => {
      if (paramsAreEmpty(p)) {
        setMatchingIds(null);
        setLoading(false);
        return;
      }
      const gen = ++generationRef.current;
      setLoading(true);
      try {
        const res = await apiCall<{ matchingIds: string[] }>(
          `/features/content-search?${buildQueryString(p)}`,
        );
        if (gen !== generationRef.current) return;
        setMatchingIds(new Set(res.matchingIds ?? []));
      } catch {
        if (gen === generationRef.current) setMatchingIds(null);
      } finally {
        if (gen === generationRef.current) setLoading(false);
      }
    },
    [apiCall],
  );

  const paramsKey = [
    params.valueContains ?? "",
    params.attribute ?? "",
    params.savedGroup ?? "",
    params.prerequisite ?? "",
    params.experiment ?? "",
    params.bandit ?? "",
  ].join("\0");

  const prevParamsKey = useRef(paramsKey);
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);

    if (paramsAreEmpty(params)) {
      setMatchingIds(null);
      prevParamsKey.current = paramsKey;
      return;
    }

    const prev = prevParamsKey.current.split("\0");
    const curr = paramsKey.split("\0");
    prevParamsKey.current = paramsKey;

    const onlyTextChanged =
      prev.slice(1).join("\0") === curr.slice(1).join("\0");
    const delay = onlyTextChanged ? DEBOUNCE_MS : 0;

    debounceTimer.current = setTimeout(() => {
      doFetch(params);
    }, delay);

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramsKey, doFetch]);

  return {
    matchingIds: paramsAreEmpty(params) ? null : matchingIds,
    loading: paramsAreEmpty(params) ? false : loading,
  };
}

import useSWR from "swr";
import { useAuth } from "@/services/auth";

export type ExperimentRef = { id: string; name: string };

export type FeatureDependents = {
  features: string[];
  experiments: ExperimentRef[];
};

// Fetches features and experiments that list the given feature as a prerequisite.
// Uses GET /features/dependents which runs getDependentFeatures/getDependentExperiments
// server-side, so only result IDs are sent down the wire instead of full feature docs.
//
// The result is cached globally by SWR key (orgId + featureId). dedupingInterval:30s
// prevents the delete/archive modal (which mounts seconds after the page) from triggering
// a duplicate fetch. After 5 minutes the cache is considered expired and re-fetched on next mount.
export function useFeatureDependents(featureId: string | null | undefined): {
  dependents: FeatureDependents | null;
  loading: boolean;
} {
  const { apiCall, orgId } = useAuth();
  const path = featureId
    ? `/features/dependents?ids=${encodeURIComponent(featureId)}`
    : null;
  const key = featureId && orgId ? `${orgId}::${path}` : null;

  const { data, isLoading } = useSWR<
    { dependents: Record<string, FeatureDependents> },
    Error
  >(key, () => apiCall(path!, { method: "GET" }), {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 300_000, // 5 minutes
  });

  return {
    dependents:
      featureId && data?.dependents
        ? (data.dependents[featureId] ?? null)
        : null,
    loading: isLoading,
  };
}

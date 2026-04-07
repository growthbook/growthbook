import useSWR from "swr";
import { useAuth } from "@/services/auth";

export type ExperimentRef = { id: string; name: string };

export type FeatureDependents = {
  features: string[];
  experiments: ExperimentRef[];
};

// Features and experiments that directly list the given feature as a prerequisite (1-hop).
// Cached for 5 minutes to avoid duplicate fetches when the delete modal mounts shortly after the page.
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

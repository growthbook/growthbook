import useSWR from "swr";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";

type PrerequisiteState = "deterministic" | "conditional" | "cyclic";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PrerequisiteValue = any;

export type PrerequisiteStateResult = {
  state: PrerequisiteState;
  value: PrerequisiteValue;
};

interface UsePrerequisiteStatesOptions {
  featureId: string;
  environments?: string[];
  enabled?: boolean;
  /**
   * If true, skips the feature's own rules and only evaluates prerequisites.
   * Used for the "Summary" row which shows the combined effect of all prerequisites.
   */
  skipRootConditions?: boolean;
}

interface PrerequisiteStatesResponse {
  status: 200;
  states: Record<string, PrerequisiteStateResult>;
}

/**
 * Hook to fetch prerequisite states for a single feature from the backend.
 * The backend evaluates prerequisites with JIT feature loading, properly handling cross-project prerequisites.
 */
export function usePrerequisiteStates({
  featureId,
  environments,
  enabled = true,
  skipRootConditions = false,
}: UsePrerequisiteStatesOptions) {
  const params = new URLSearchParams();
  if (environments?.length) {
    params.set("environments", environments.join(","));
  }
  if (skipRootConditions) {
    params.set("skipRootConditions", "true");
  }
  const queryString = params.toString();
  const url = `/feature/${featureId}/prerequisite-states${queryString ? `?${queryString}` : ""}`;

  const { data, error, mutate } = useApi<PrerequisiteStatesResponse>(url, {
    shouldRun: () => enabled && !!featureId,
    refreshInterval: 5 * 60 * 1000, // Refetch every 5 minutes to catch changes from other tabs/users
  });

  return {
    states: data?.states || null,
    loading: !data && !error && enabled && !!featureId,
    error,
    mutate,
  };
}

interface BatchPrerequisiteStatesResponse {
  status: 200;
  results: Record<string, Record<string, PrerequisiteStateResult>>;
}

interface UseBatchPrerequisiteStatesOptions {
  featureIds: string[];
  environments: string[];
  enabled?: boolean;
}

/**
 * Hook to fetch prerequisite states for multiple features in a single request.
 * More efficient for use cases like feature selection dropdowns.
 */
export function useBatchPrerequisiteStates({
  featureIds,
  environments,
  enabled = true,
}: UseBatchPrerequisiteStatesOptions) {
  const { apiCall, orgId } = useAuth();

  // Create a stable key for SWR based on the request parameters
  const key =
    enabled && featureIds.length && environments.length
      ? `${orgId}::/features/batch-prerequisite-states|${featureIds
          .slice()
          .sort()
          .join(",")}|${environments.slice().sort().join(",")}`
      : null;

  const { data, error, mutate } = useSWR<BatchPrerequisiteStatesResponse>(
    key,
    async () => {
      return apiCall<BatchPrerequisiteStatesResponse>(
        "/features/batch-prerequisite-states",
        {
          method: "POST",
          body: JSON.stringify({ featureIds, environments }),
        },
      );
    },
  );

  return {
    results: data?.results || null,
    loading:
      !data &&
      !error &&
      enabled &&
      featureIds.length > 0 &&
      environments.length > 0,
    error,
    mutate,
  };
}

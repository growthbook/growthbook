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
  // Skip feature's own rules, only evaluate prerequisites (for summary row)
  skipRootConditions?: boolean;
  // When provided, the backend merges this revision before evaluating so that
  // draft prerequisites and kill-switch states are properly reflected.
  version?: number | null;
}

interface PrerequisiteStatesResponse {
  status: 200;
  states: Record<string, PrerequisiteStateResult>;
}

export interface UsePrerequisiteStatesReturn {
  states: Record<string, PrerequisiteStateResult> | null;
  loading: boolean;
  error: Error | undefined;
  mutate: () => void;
}

export function usePrerequisiteStates({
  featureId,
  environments,
  enabled = true,
  skipRootConditions = false,
  version,
}: UsePrerequisiteStatesOptions): UsePrerequisiteStatesReturn {
  const params = new URLSearchParams();
  if (environments?.length) {
    params.set("environments", environments.join(","));
  }
  if (skipRootConditions) {
    params.set("skipRootConditions", "true");
  }
  if (version != null) {
    params.set("version", String(version));
  }
  const queryString = params.toString();
  const url = `/feature/${featureId}/prerequisite-states${queryString ? `?${queryString}` : ""}`;

  const { data, error, mutate } = useApi<PrerequisiteStatesResponse>(url, {
    shouldRun: () => enabled && !!featureId,
    refreshInterval: 5 * 60 * 1000, // 5 minutes
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
  results: Record<
    string,
    {
      states: Record<string, PrerequisiteStateResult>;
      wouldBeCyclic: boolean;
    }
  >;
}

interface UseBatchPrerequisiteStatesOptions {
  baseFeatureId: string;
  featureIds: string[];
  environments: string[];
  enabled?: boolean;
  isExperiment?: boolean;
}

export interface UseBatchPrerequisiteStatesReturn {
  results: Record<
    string,
    {
      states: Record<string, PrerequisiteStateResult>;
      wouldBeCyclic: boolean;
    }
  > | null;
  loading: boolean;
  error: Error | undefined;
  mutate: () => void;
}

export function useBatchPrerequisiteStates({
  baseFeatureId,
  featureIds,
  environments,
  enabled = true,
  isExperiment = false,
}: UseBatchPrerequisiteStatesOptions): UseBatchPrerequisiteStatesReturn {
  const { apiCall, orgId } = useAuth();

  const key =
    enabled && environments.length && featureIds.length > 0
      ? `${orgId}::/features/batch-prerequisite-states|${isExperiment ? "" : baseFeatureId}|${featureIds
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
          body: JSON.stringify({
            featureIds,
            environments,
            ...(baseFeatureId && !isExperiment && { baseFeatureId }),
          }),
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
      (!!baseFeatureId || isExperiment) &&
      environments.length > 0 &&
      featureIds.length > 0,
    error,
    mutate,
  };
}

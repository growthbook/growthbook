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

// Fetch prerequisite states for a single feature (backend uses JIT loading for cross-project prerequisites)
export function usePrerequisiteStates({
  featureId,
  environments,
  enabled = true,
  skipRootConditions = false,
}: UsePrerequisiteStatesOptions): UsePrerequisiteStatesReturn {
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
  checkPrerequisiteCyclic?: {
    wouldBeCyclic: boolean;
    cyclicFeatureId: string | null;
  };
  checkRulePrerequisitesCyclic?: {
    wouldBeCyclic: boolean;
    cyclicFeatureId: string | null;
  };
}

interface UseBatchPrerequisiteStatesOptions {
  baseFeatureId: string;
  featureIds: string[];
  environments: string[];
  enabled?: boolean;
  isExperiment?: boolean; // Use experiment-specific endpoint without cyclic checks
  checkPrerequisite?: {
    id: string;
    condition: string;
    prerequisiteIndex?: number;
  };
  checkRulePrerequisites?: {
    environment: string;
    ruleIndex: number;
    prerequisites: Array<{ id: string; condition: string }>;
  };
}

export interface UseBatchPrerequisiteStatesReturn {
  results: Record<
    string,
    {
      states: Record<string, PrerequisiteStateResult>;
      wouldBeCyclic: boolean;
    }
  > | null;
  checkPrerequisiteCyclic?: {
    wouldBeCyclic: boolean;
    cyclicFeatureId: string | null;
  };
  checkRulePrerequisitesCyclic?: {
    wouldBeCyclic: boolean;
    cyclicFeatureId: string | null;
  };
  loading: boolean;
  error: Error | undefined;
  mutate: () => void;
}

// Batch fetch prerequisite states and cyclic checks for multiple features
export function useBatchPrerequisiteStates({
  baseFeatureId,
  featureIds,
  environments,
  enabled = true,
  isExperiment = false,
  checkPrerequisite,
  checkRulePrerequisites,
}: UseBatchPrerequisiteStatesOptions): UseBatchPrerequisiteStatesReturn {
  const { apiCall, orgId } = useAuth();

  // Allow request if we have featureIds OR if we're doing cycle checks
  const hasCycleCheck = !!(checkPrerequisite || checkRulePrerequisites);
  const rulePrereqsKey = checkRulePrerequisites
    ? `checkRule:${checkRulePrerequisites.environment}:${checkRulePrerequisites.ruleIndex}:${checkRulePrerequisites.prerequisites
        .map((p) => `${p.id}:${p.condition}`)
        .sort()
        .join(",")}`
    : "";

  const key =
    enabled && environments.length && (featureIds.length > 0 || hasCycleCheck)
      ? `${orgId}::/features/batch-prerequisite-states|${isExperiment ? "" : baseFeatureId}|${featureIds
          .slice()
          .sort()
          .join(
            ",",
          )}|${environments.slice().sort().join(",")}|${checkPrerequisite ? `checkPrereq:${checkPrerequisite.id}:${checkPrerequisite.prerequisiteIndex ?? -1}` : ""}|${rulePrereqsKey}`
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
            ...(checkPrerequisite && { checkPrerequisite }),
            ...(checkRulePrerequisites && { checkRulePrerequisites }),
          }),
        },
      );
    },
  );

  return {
    results: data?.results || null,
    checkPrerequisiteCyclic: data?.checkPrerequisiteCyclic,
    checkRulePrerequisitesCyclic: data?.checkRulePrerequisitesCyclic,
    loading:
      !data &&
      !error &&
      enabled &&
      (!!baseFeatureId || isExperiment) &&
      environments.length > 0 &&
      (featureIds.length > 0 || hasCycleCheck),
    error,
    mutate,
  };
}

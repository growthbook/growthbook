import useApi from "@/hooks/useApi";
import { isCloud } from "@/services/env";

export type AITokenUsage = {
  numTokensUsed: number;
  // null when the org has no cap
  dailyLimit: number | null;
  nextResetAt: number;
};

type APIResponse = {
  status: number;
  tokenUsage: AITokenUsage;
};

type UseAITokenUsageResult = {
  data: AITokenUsage | null | undefined;
  error: Error | undefined;
  isLoading: boolean;
};

// `enabled: false` skips the request, as off Cloud.
export function useAITokenUsage({
  enabled = true,
}: { enabled?: boolean } = {}): UseAITokenUsageResult {
  const shouldRun = isCloud() && enabled;
  const { data, error } = useApi<APIResponse>("/ai/token-usage", {
    shouldRun: () => shouldRun,
  });

  if (!shouldRun) {
    return {
      data: null,
      error: undefined,
      isLoading: false,
    };
  }

  return {
    data: data?.tokenUsage,
    error,
    isLoading: !data && !error,
  };
}

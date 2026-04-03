import useApi from "@/hooks/useApi";
import { isCloud } from "@/services/env";

export type AITokenUsage = {
  numTokensUsed: number;
  dailyLimit: number;
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

export function useAITokenUsage(): UseAITokenUsageResult {
  const { data, error } = useApi<APIResponse>("/ai/token-usage", {
    shouldRun: () => isCloud(),
  });

  if (!isCloud()) {
    return {
      data: {
        numTokensUsed: 234528,
        dailyLimit: 1000000,
        nextResetAt: new Date().getTime() + 24 * 60 * 60 * 1000,
      },
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

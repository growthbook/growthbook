import { AISuggestionType, formatAIRateLimitRetryMessage } from "shared/ai";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { AppFeatures } from "shared/types/app-features";
import { useAuth } from "@/services/auth";
import track from "@/services/track";

// Throws on failure: the field shows the error, and owns the opt-in and
// premium gates.
export function useSuggestHypothesis(hypothesis: string, source: string) {
  const { apiCall } = useAuth();
  const gb = useGrowthBook<AppFeatures>();
  return async (type: AISuggestionType) => {
    const temperature =
      gb?.getFeatureValue("ai-suggestions-temperature", 0.1) || 0.1;
    let failure: string | null = null;
    const res = await apiCall<{ data?: { output?: string } }>(
      `/ai/reformat`,
      {
        method: "POST",
        body: JSON.stringify({
          type: "experiment-hypothesis",
          text: hypothesis,
          temperature,
        }),
      },
      (responseData) => {
        failure =
          responseData.status === 429
            ? formatAIRateLimitRetryMessage(responseData.retryAfter)
            : responseData.message || "Error getting AI suggestion";
      },
    );
    if (failure) throw new Error(failure);
    track("ai-suggestion", { source, type });
    return res?.data?.output ?? "";
  };
}

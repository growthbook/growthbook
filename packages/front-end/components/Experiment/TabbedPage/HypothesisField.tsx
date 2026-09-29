import { useRef } from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import {
  AISuggestionType,
  computeAIUsageData,
  formatAIRateLimitRetryMessage,
} from "shared/ai";
import { useGrowthBook } from "@growthbook/growthbook-react";
import { AppFeatures } from "shared/types/app-features";
import { useAuth } from "@/services/auth";
import track from "@/services/track";
import InlineMarkdownField from "@/components/Experiment/TabbedPage/InlineMarkdownField";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  editable: boolean;
  /** Past draft, the hypothesis still opens for editing from its pencil. */
  canEdit: boolean;
}

export default function HypothesisField({
  experiment,
  editable,
  canEdit,
}: Props) {
  const { apiCall } = useAuth();
  const gb = useGrowthBook<AppFeatures>();
  const aiSuggestion = useRef<string | null>(null);

  // Throws on failure: the field shows the error, and owns the opt-in and
  // premium gates.
  const suggestHypothesis = async (type: AISuggestionType) => {
    const temperature =
      gb?.getFeatureValue("ai-suggestions-temperature", 0.1) || 0.1;
    let failure: string | null = null;
    const res = await apiCall<{ data?: { output?: string } }>(
      `/ai/reformat`,
      {
        method: "POST",
        body: JSON.stringify({
          type: "experiment-hypothesis",
          text: experiment.hypothesis || "",
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
    track("ai-suggestion", { source: "experiment-setup-tab", type });
    return res?.data?.output ?? "";
  };

  return (
    <InlineMarkdownField
      label="Hypothesis"
      experiment={experiment}
      field="hypothesis"
      placeholder="What do you expect to happen, and why?"
      editable={editable}
      editOnDemand={canEdit}
      emptyLabel="No hypothesis"
      onSaved={(hypothesis) => {
        if (aiSuggestion.current) {
          track("experiment-hypothesis-saved-after-ai-suggestion", {
            aiUsageData: computeAIUsageData({
              value: hypothesis,
              aiSuggestionText: aiSuggestion.current,
            }),
          });
        }
      }}
      aiSuggestFunction={suggestHypothesis}
      aiButtonText="Check Hypothesis"
      onAISuggestionReceived={(result) => {
        aiSuggestion.current = result;
      }}
      trackingSource="experiment-setup-tab"
    />
  );
}

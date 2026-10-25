import { useRef, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
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
import Markdown from "@/components/Markdown/Markdown";
import AIRichTextField from "@/components/Markdown/AIRichTextField";
import Text from "@/ui/Text";
import {
  useExperimentFieldEdit,
  useStagedState,
} from "@/components/Experiment/TabbedPage/ExperimentEdits";
import SetupFieldRow from "@/components/Experiment/TabbedPage/SetupFieldRow";
import QuickEditButton, {
  revealsQuickEdit,
} from "@/components/Experiment/TabbedPage/QuickEditButton";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  // Show the editor rather than the rendered markdown.
  editable: boolean;
  // Where not editable, it still opens for editing from its pencil.
  canEdit: boolean;
}

export default function HypothesisField({
  experiment,
  editable: editableHere,
  canEdit,
}: Props) {
  const { apiCall } = useAuth();
  const gb = useGrowthBook<AppFeatures>();
  const aiSuggestion = useRef<string | null>(null);

  const savedValue = experiment.hypothesis || "";
  const [value, setValue] = useStagedState("inline:hypothesis", savedValue);
  const [editingOnDemand, setEditingOnDemand] = useState(
    () => value.trim() !== savedValue.trim(),
  );
  const editable = editableHere || editingOnDemand;

  const dirty = editable && value.trim() !== savedValue.trim();
  useExperimentFieldEdit("inline:hypothesis", dirty, experiment, {
    label: "Hypothesis",
    fields: () => ({ hypothesis: value.trim() }),
    onSaved: () => {
      if (aiSuggestion.current) {
        track("experiment-hypothesis-saved-after-ai-suggestion", {
          aiUsageData: computeAIUsageData({
            value: value.trim(),
            aiSuggestionText: aiSuggestion.current,
          }),
        });
      }
      setEditingOnDemand(false);
    },
    discard: () => {
      setValue(savedValue);
      setEditingOnDemand(false);
    },
  });

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
          text: value,
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

  const body = editable ? (
    <AIRichTextField
      value={value}
      onChange={setValue}
      placeholder="What do you expect to happen, and why?"
      aiSuggestFunction={suggestHypothesis}
      aiButtonText="Check Hypothesis"
      onAISuggestionReceived={(result) => {
        aiSuggestion.current = result;
      }}
      trackingSource="experiment-setup-tab"
      collapsibleToolbar
    />
  ) : savedValue ? (
    <Markdown>{savedValue}</Markdown>
  ) : (
    <Text weight="regular" color="text-mid" size="md" fontStyle="italic">
      No hypothesis
    </Text>
  );

  return (
    <SetupFieldRow
      label="Hypothesis"
      labelSize="lg"
      content={editable ? "control" : "text"}
      // One line with its pencil, so the label centres on it.
      labelAlign={!editable && !savedValue ? "center" : "top"}
    >
      {!editable && canEdit ? (
        <Flex
          align={savedValue ? "start" : "center"}
          gap="2"
          className={revealsQuickEdit}
        >
          <Box minWidth="0">{body}</Box>
          <QuickEditButton
            label="Edit hypothesis"
            onClick={() => setEditingOnDemand(true)}
          />
        </Flex>
      ) : (
        body
      )}
    </SetupFieldRow>
  );
}

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
import AIRichTextField from "@/components/Markdown/AIRichTextField";
import {
  useExperimentFieldEdit,
  useStagedState,
} from "@/components/Experiment/TabbedPage/ExperimentEdits";
import SetupFieldRow from "@/components/Experiment/TabbedPage/SetupFieldRow";
import QuickEditButton, {
  revealsQuickEdit,
} from "@/components/Experiment/TabbedPage/QuickEditButton";
import ExperimentTextValue, {
  EXPERIMENT_TEXT_FIELDS,
  ExperimentTextFieldKey,
} from "./ExperimentTextValue";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  field: ExperimentTextFieldKey;
  // Show the editor rather than the rendered markdown.
  editable: boolean;
  // Where not editable, it still opens for editing from its pencil.
  canEdit: boolean;
}

export default function ExperimentTextField({
  experiment,
  field,
  editable: editableHere,
  canEdit,
}: Props) {
  const { apiCall } = useAuth();
  const gb = useGrowthBook<AppFeatures>();
  const aiSuggestion = useRef<string | null>(null);
  const { label, placeholder } = EXPERIMENT_TEXT_FIELDS[field];
  const isHypothesis = field === "hypothesis";
  const slot = `inline:${field}`;

  const savedValue = experiment[field] || "";
  const [value, setValue, clearValue] = useStagedState(slot, savedValue);
  const [editingOnDemand, setEditingOnDemand] = useState(
    () => value.trim() !== savedValue.trim(),
  );
  const editable = editableHere || editingOnDemand;

  const dirty = editable && value.trim() !== savedValue.trim();
  useExperimentFieldEdit(slot, dirty, experiment, {
    label,
    fields: () =>
      isHypothesis
        ? { hypothesis: value.trim() }
        : { description: value.trim() },
    onSaved: () => {
      if (aiSuggestion.current) {
        track("experiment-hypothesis-saved-after-ai-suggestion", {
          aiUsageData: computeAIUsageData({
            value: value.trim(),
            aiSuggestionText: aiSuggestion.current,
          }),
        });
      }
      // Saved, it's what's stored; still staged, it would revert a later change.
      clearValue();
      setEditingOnDemand(false);
    },
    discard: () => {
      clearValue();
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
      placeholder={placeholder}
      aiSuggestFunction={isHypothesis ? suggestHypothesis : undefined}
      aiButtonText="Check hypothesis"
      onAISuggestionReceived={(result) => {
        aiSuggestion.current = result;
      }}
      trackingSource="experiment-setup-tab"
      collapsibleToolbar
    />
  ) : (
    <ExperimentTextValue field={field} value={savedValue} />
  );

  return (
    <SetupFieldRow
      label={label}
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
            label={`Edit ${field}`}
            onClick={() => setEditingOnDemand(true)}
          />
        </Flex>
      ) : (
        body
      )}
    </SetupFieldRow>
  );
}

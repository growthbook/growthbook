import { useRef, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { computeAIUsageData } from "shared/ai";
import track from "@/services/track";
import { useSuggestHypothesis } from "@/components/Experiment/useSuggestHypothesis";
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
  const aiSuggestion = useRef<string | null>(null);
  const { label } = EXPERIMENT_TEXT_FIELDS[field];
  const placeholder = EXPERIMENT_TEXT_FIELDS[field].placeholder(
    experiment.type,
  );
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

  const suggestHypothesis = useSuggestHypothesis(value, "experiment-setup-tab");

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

import { ReactNode, useRef, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { AISuggestionType } from "shared/ai";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import Markdown from "@/components/Markdown/Markdown";
import AIRichTextField from "@/components/Markdown/AIRichTextField";
import { RichTextEditorHandle } from "@/ui/RichTextEditor";
import Text from "@/ui/Text";
import {
  experimentFieldChanges,
  useRegisterExperimentEdit,
} from "@/components/Experiment/TabbedPage/ExperimentEdits";
import SetupFieldRow from "@/components/Experiment/TabbedPage/SetupFieldRow";
import Metadata from "@/ui/Metadata";
import QuickEditButton, {
  revealsQuickEdit,
} from "@/components/Experiment/TabbedPage/QuickEditButton";
import ExpandableBlock from "./ExpandableBlock";

export interface Props {
  label: string;
  experiment: ExperimentInterfaceStringDates;
  field: "hypothesis" | "description";
  placeholder?: string;
  /** Show the editor rather than the rendered markdown. */
  editable: boolean;
  onSaved?: (next: string) => void;
  aiSuggestFunction?: (type: AISuggestionType) => Promise<string>;
  aiButtonText?: string;
  onAISuggestionReceived?: (result: string) => void;
  trackingSource?: string;
  /** Label above the field, to sit alongside the other metadata in a narrow column. */
  stacked?: boolean;
  /** Beside a stacked label, such as the field's own edit button. */
  labelAction?: ReactNode;
  /**
   * When not `editable`, offer a pencil that opens the editor anyway, for a
   * field that is safe to change at any stage.
   */
  editOnDemand?: boolean;
  /** Shown in place of an empty value that isn't being edited. */
  emptyLabel?: string;
}

/**
 * A markdown field edited in place on the page and written by its Save bar, or
 * read back as markdown where it isn't editable.
 */
export default function InlineMarkdownField({
  label,
  experiment,
  field,
  placeholder,
  editable: editableHere,
  onSaved,
  aiSuggestFunction,
  aiButtonText,
  onAISuggestionReceived,
  trackingSource,
  stacked,
  labelAction,
  editOnDemand,
  emptyLabel,
}: Props) {
  const savedValue = experiment[field] || "";
  const [editingOnDemand, setEditingOnDemand] = useState(false);
  const editable = editableHere || editingOnDemand;
  const [value, setValue] = useState(savedValue);
  const editor = useRef<RichTextEditorHandle>(null);

  const dirty = editable && value.trim() !== savedValue.trim();
  useRegisterExperimentEdit(`inline:${field}`, dirty, {
    changes: () =>
      experimentFieldChanges(experiment, { [field]: value.trim() }),
    onSaved: () => {
      onSaved?.(value.trim());
      setEditingOnDemand(false);
    },
    discard: () => {
      setValue(savedValue);
      // The editor holds its own document, so the reset has to reach it too.
      editor.current?.setMarkdown(savedValue);
      setEditingOnDemand(false);
    },
  });

  let body: ReactNode;
  if (!editable) {
    if (!savedValue) {
      // In a column of metadata an empty row still reads as a field; on the
      // page on its own it would just be noise, unless it can be filled in.
      if (!stacked && !editOnDemand) return null;
      body = (
        <Text
          weight="regular"
          color="text-mid"
          size={stacked ? "sm" : "md"}
          fontStyle="italic"
        >
          {emptyLabel ?? "None"}
        </Text>
      );
    } else {
      body = stacked ? (
        // Beside the page rather than on it, so it reads at the column's size,
        // and a long one doesn't push the rest of the column away.
        <ExpandableBlock>
          <Box style={{ fontSize: "var(--font-size-1)" }}>
            <Markdown>{savedValue}</Markdown>
          </Box>
        </ExpandableBlock>
      ) : (
        <Markdown>{savedValue}</Markdown>
      );
    }
  } else {
    body = (
      <AIRichTextField
        ref={editor}
        value={value}
        onChange={setValue}
        placeholder={placeholder}
        height={stacked ? "sm" : "md"}
        aiSuggestFunction={aiSuggestFunction}
        aiButtonText={aiButtonText}
        onAISuggestionReceived={onAISuggestionReceived}
        trackingSource={trackingSource}
      />
    );
  }
  if (!editable && editOnDemand) {
    body = (
      <Flex
        align={savedValue ? "start" : "center"}
        gap="2"
        className={revealsQuickEdit}
      >
        <Box minWidth="0">{body}</Box>
        <QuickEditButton
          label={`Edit ${label.toLowerCase()}`}
          onClick={() => setEditingOnDemand(true)}
        />
      </Flex>
    );
  }

  if (stacked) {
    return (
      <Metadata
        size="sm"
        stacked
        style={{ width: "100%" }}
        label={label}
        action={labelAction}
        value={<Box width="100%">{body}</Box>}
      />
    );
  }

  return (
    <SetupFieldRow
      label={label}
      labelSize="lg"
      content={editable ? "control" : "text"}
      // One line with its pencil, so the label centres on it.
      labelAlign={!editable && !savedValue ? "center" : "top"}
    >
      {body}
    </SetupFieldRow>
  );
}

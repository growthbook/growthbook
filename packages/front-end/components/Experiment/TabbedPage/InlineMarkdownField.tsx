import { ReactNode, useRef, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiPlus } from "react-icons/pi";
import { AISuggestionType } from "shared/ai";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import Markdown from "@/components/Markdown/Markdown";
import AISuggestButton from "@/components/Markdown/AISuggestButton";
import RichTextEditor, { RichTextEditorHandle } from "@/ui/RichTextEditor";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import Callout from "@/ui/Callout";
import {
  experimentFieldChanges,
  useRegisterExperimentEdit,
} from "@/components/Experiment/TabbedPage/ExperimentEdits";
import SetupFieldRow from "@/components/Experiment/TabbedPage/SetupFieldRow";
import Metadata from "@/ui/Metadata";
import ExpandableBlock from "./ExpandableBlock";

export interface Props {
  label: string;
  experiment: ExperimentInterfaceStringDates;
  field: "hypothesis" | "description";
  placeholder?: string;
  /** Show the editor rather than the rendered markdown. */
  editable: boolean;
  onSaved?: (next: string) => void;
  /**
   * With nothing saved yet, collapse to a "+ {addLabel}" button until the user
   * asks for the field. Omit to always show the editor.
   */
  addLabel?: string;
  aiSuggestFunction?: (type: AISuggestionType) => Promise<string>;
  aiButtonText?: string;
  onAISuggestionReceived?: (result: string) => void;
  trackingSource?: string;
  /** Label above the field, to sit alongside the other metadata in a narrow column. */
  stacked?: boolean;
  /** Beside a stacked label, such as the field's own edit button. */
  labelAction?: ReactNode;
}

/**
 * A markdown field edited in place on the page — no modal. Saves on blur, and
 * renders read-only markdown once the experiment is past draft.
 */
export default function InlineMarkdownField({
  label,
  experiment,
  field,
  placeholder,
  editable,
  onSaved,
  addLabel,
  aiSuggestFunction,
  aiButtonText,
  onAISuggestionReceived,
  trackingSource,
  stacked,
  labelAction,
}: Props) {
  const savedValue = experiment[field] || "";
  const [value, setValue] = useState(savedValue);
  const editor = useRef<RichTextEditorHandle>(null);
  // What the field held before a suggestion replaced it, so it can be undone.
  const [beforeSuggestion, setBeforeSuggestion] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);

  // State and editor together: the editor holds its own document, so setting
  // one without the other leaves the two disagreeing.
  const replaceValue = (next: string) => {
    setValue(next);
    editor.current?.setMarkdown(next);
  };

  // Written by the page's Save bar.
  const dirty = editable && value.trim() !== savedValue.trim();
  useRegisterExperimentEdit(`inline:${field}`, dirty, {
    changes: () =>
      experimentFieldChanges(experiment, { [field]: value.trim() }),
    onSaved: () => onSaved?.(value.trim()),
    discard: () => {
      replaceValue(savedValue);
    },
  });

  if (editable && addLabel && !savedValue && !revealed) {
    return stacked ? (
      <Metadata
        size="sm"
        stacked
        label={label}
        action={labelAction}
        value={<Link onClick={() => setRevealed(true)}>+Add</Link>}
      />
    ) : (
      <Box py="1">
        <Link onClick={() => setRevealed(true)}>
          <Flex align="center" gap="1">
            <PiPlus size="15" />
            <Text weight="semibold">{addLabel}</Text>
          </Flex>
        </Link>
      </Box>
    );
  }

  let body: ReactNode;
  if (!editable) {
    if (!savedValue) {
      // In a column of metadata an empty row still reads as a field; on the
      // page on its own it would just be noise.
      if (!stacked) return null;
      body = (
        <Text
          weight="regular"
          color="text-mid"
          size={stacked ? "sm" : "md"}
          fontStyle="italic"
        >
          None
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
      <Box>
        <RichTextEditor
          ref={editor}
          value={value}
          onChange={setValue}
          placeholder={placeholder}
          autoFocus={revealed}
          height={stacked ? "sm" : "md"}
          autoGrow
          footer={
            aiSuggestFunction ? (
              <Flex
                align="center"
                justify="end"
                gap="2"
                px="3"
                pb="3"
                wrap="wrap"
              >
                <AISuggestButton
                  suggest={aiSuggestFunction}
                  label={aiButtonText}
                  trackingSource={trackingSource}
                  onError={setAiError}
                  onSuggestion={(suggestion) => {
                    setAiError(null);
                    onAISuggestionReceived?.(suggestion);
                    setBeforeSuggestion(value);
                    replaceValue(suggestion);
                  }}
                />
                {beforeSuggestion !== null ? (
                  <Link
                    onClick={() => {
                      replaceValue(beforeSuggestion);
                      setBeforeSuggestion(null);
                    }}
                  >
                    <Text weight="semibold">Undo suggestion</Text>
                  </Link>
                ) : null}
              </Flex>
            ) : null
          }
        />
      </Box>
    );
  }

  const shownError = aiError;
  const errorCallout = shownError ? (
    <Callout status="error" size="sm" mt="2">
      {shownError}
    </Callout>
  ) : null;

  if (stacked) {
    return (
      <Metadata
        size="sm"
        stacked
        style={{ width: "100%" }}
        label={label}
        action={labelAction}
        value={
          <Box width="100%">
            {body}
            {errorCallout}
          </Box>
        }
      />
    );
  }

  return (
    <SetupFieldRow label={label} labelSize="lg">
      {body}
      {errorCallout}
    </SetupFieldRow>
  );
}

import { ReactNode, useRef, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiPlus } from "react-icons/pi";
import { AISuggestionType } from "shared/ai";
import Markdown from "@/components/Markdown/Markdown";
import AISuggestButton from "@/components/Markdown/AISuggestButton";
import RichTextEditor, { RichTextEditorHandle } from "@/ui/RichTextEditor";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
import { useRegisterExperimentEdit } from "@/components/Experiment/TabbedPage/ExperimentEdits";
import Metadata from "@/ui/Metadata";

export interface Props {
  label: string;
  /** The saved value. */
  value: string;
  placeholder: string;
  /** Show the editor rather than the rendered markdown. */
  editable: boolean;
  onSave: (next: string) => Promise<void>;
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
}

/**
 * A markdown field edited in place on the page — no modal. Saves on blur, and
 * renders read-only markdown once the experiment is past draft.
 */
export default function InlineMarkdownField({
  label,
  value: savedValue,
  placeholder,
  editable,
  onSave,
  addLabel,
  aiSuggestFunction,
  aiButtonText,
  onAISuggestionReceived,
  trackingSource,
  stacked,
}: Props) {
  const [value, setValue] = useState(savedValue);
  const editor = useRef<RichTextEditorHandle>(null);
  // What the field held before a suggestion replaced it, so it can be undone.
  const [beforeSuggestion, setBeforeSuggestion] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  // What the server holds, so a blur that changed nothing writes nothing.
  const saved = useRef(savedValue);

  // The page's save bar writes this, so a field losing focus no longer posts.
  const dirty = editable && value.trim() !== savedValue.trim();
  useRegisterExperimentEdit(`inline:${label}`, dirty, {
    save: async () => {
      const next = value.trim();
      setError(null);
      try {
        await onSave(next);
        saved.current = next;
      } catch (e) {
        const message =
          e.message || `Could not save the ${label.toLowerCase()}`;
        setError(message);
        throw new Error(message);
      }
    },
    discard: () => {
      setValue(savedValue);
      setError(null);
      editor.current?.setMarkdown(savedValue);
    },
  });

  if (editable && addLabel && !saved.current && !revealed) {
    return stacked ? (
      <Metadata
        stacked
        label={label}
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
        <Text weight="regular" color="text-mid">
          None
        </Text>
      );
    } else {
      body = <Markdown>{savedValue}</Markdown>;
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
                    setValue(suggestion);
                    editor.current?.setMarkdown(suggestion);
                  }}
                />
                {beforeSuggestion !== null ? (
                  <Link
                    onClick={() => {
                      setValue(beforeSuggestion);
                      editor.current?.setMarkdown(beforeSuggestion);
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

  const shownError = error || aiError;
  const errorCallout = shownError ? (
    <Callout status="error" size="sm" mt="2">
      {shownError}
    </Callout>
  ) : null;

  if (stacked) {
    return (
      <Metadata
        stacked
        style={{ width: "100%" }}
        label={label}
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
    <Flex align="start" gap="4" py="4">
      <Box flexShrink="0" width="180px">
        <Heading color="text-high" as="h4" size="sm" mb="0">
          {label}
        </Heading>
      </Box>
      <Box flexGrow="1" minWidth="0">
        {body}
        {errorCallout}
      </Box>
    </Flex>
  );
}

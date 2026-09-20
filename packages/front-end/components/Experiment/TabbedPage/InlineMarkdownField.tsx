import { ReactNode, useRef, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiPlus } from "react-icons/pi";
import { AISuggestionType } from "shared/ai";
import Markdown from "@/components/Markdown/Markdown";
import MarkdownInput from "@/components/Markdown/MarkdownInput";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import Callout from "@/ui/Callout";
import Heading from "@/ui/Heading";
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
  aiSuggestionHeader?: string;
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
  aiSuggestionHeader,
  onAISuggestionReceived,
  trackingSource,
  stacked,
}: Props) {
  const [value, setValue] = useState(savedValue);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  // What the server holds, so a blur that changed nothing writes nothing.
  const saved = useRef(savedValue);

  const save = async () => {
    const next = value.trim();
    if (next === saved.current.trim()) return;
    setError(null);
    try {
      await onSave(next);
      saved.current = next;
    } catch (e) {
      setError(e.message || `Could not save the ${label.toLowerCase()}`);
    }
  };

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
    // Nothing to say and no way to add it: the row would be noise.
    if (!savedValue) return null;
    body = <Markdown>{savedValue}</Markdown>;
  } else {
    body = (
      // Saved on blur instead of behind a modal. React blur bubbles, so this
      // covers the textarea, the preview tab and any AI controls.
      <Box onBlur={save}>
        <MarkdownInput
          value={value}
          setValue={setValue}
          placeholder={placeholder}
          showButtons={false}
          autofocus={revealed}
          autofocusAtEnd={revealed}
          aiSuggestFunction={
            aiSuggestFunction ? () => aiSuggestFunction("suggest") : undefined
          }
          aiButtonText={aiButtonText}
          aiSuggestionHeader={aiSuggestionHeader}
          onAISuggestionReceived={onAISuggestionReceived}
          trackingSource={trackingSource}
        />
      </Box>
    );
  }

  const errorCallout = error ? (
    <Callout status="error" size="sm" mt="2">
      {error}
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

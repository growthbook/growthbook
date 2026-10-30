import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { AISuggestionType } from "shared/ai";
import AISuggestButton from "@/components/Markdown/AISuggestButton";
import RichTextEditor, { RichTextHeight } from "@/ui/RichTextEditor";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import Text from "@/ui/Text";

export interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  height?: RichTextHeight;
  aiSuggestFunction?: (type: AISuggestionType) => Promise<string>;
  aiButtonText?: string;
  onAISuggestionReceived?: (result: string) => void;
  trackingSource?: string;
  collapsibleToolbar?: boolean;
  onUploadingChange?: (uploading: boolean) => void;
  ariaLabelledBy?: string;
}

// A rich text editor with an AI suggestion in its footer; a suggestion replaces
// the text and can be undone.
export default function AIRichTextField({
  value,
  onChange,
  placeholder,
  autoFocus,
  height = "md",
  aiSuggestFunction,
  aiButtonText,
  onAISuggestionReceived,
  trackingSource,
  collapsibleToolbar = false,
  onUploadingChange,
  ariaLabelledBy,
}: Props) {
  // What the field held before a suggestion replaced it, so it can be undone.
  const [beforeSuggestion, setBeforeSuggestion] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  return (
    <Box>
      <RichTextEditor
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoFocus={autoFocus}
        height={height}
        autoGrow
        collapsibleToolbar={collapsibleToolbar}
        onUploadingChange={onUploadingChange}
        ariaLabelledBy={ariaLabelledBy}
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
                  onChange(suggestion);
                }}
              />
              {beforeSuggestion !== null ? (
                <Link
                  onClick={() => {
                    onChange(beforeSuggestion);
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
      {aiError ? (
        <Callout status="error" size="sm" mt="2">
          {aiError}
        </Callout>
      ) : null}
    </Box>
  );
}

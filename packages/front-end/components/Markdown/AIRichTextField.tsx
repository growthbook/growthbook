import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { AISuggestionType } from "shared/ai";
import AISuggestButton from "@/components/Markdown/AISuggestButton";
import RichTextEditor, {
  RichTextEditorHandle,
  RichTextHeight,
} from "@/ui/RichTextEditor";
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
}

/**
 * The rich text editor with its AI suggestion inside the footer: a suggestion
 * replaces the text and can be undone.
 */
const AIRichTextField = forwardRef<RichTextEditorHandle, Props>(
  function AIRichTextField(
    {
      value,
      onChange,
      placeholder,
      autoFocus,
      height = "md",
      aiSuggestFunction,
      aiButtonText,
      onAISuggestionReceived,
      trackingSource,
    },
    ref,
  ) {
    const editor = useRef<RichTextEditorHandle>(null);
    useImperativeHandle(ref, () => ({
      getMarkdown: () => editor.current?.getMarkdown() ?? "",
      setMarkdown: (markdown: string) => editor.current?.setMarkdown(markdown),
      focus: () => editor.current?.focus(),
    }));
    // What the field held before a suggestion replaced it, so it can be undone.
    const [beforeSuggestion, setBeforeSuggestion] = useState<string | null>(
      null,
    );
    const [aiError, setAiError] = useState<string | null>(null);

    // State and editor together: the editor holds its own document, so setting
    // one without the other leaves the two disagreeing.
    const replaceValue = (next: string) => {
      onChange(next);
      editor.current?.setMarkdown(next);
    };

    return (
      <Box>
        <RichTextEditor
          ref={editor}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          autoFocus={autoFocus}
          height={height}
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
        {aiError ? (
          <Callout status="error" size="sm" mt="2">
            {aiError}
          </Callout>
        ) : null}
      </Box>
    );
  },
);

export default AIRichTextField;

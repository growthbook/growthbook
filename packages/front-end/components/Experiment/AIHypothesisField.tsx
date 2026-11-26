import { useId } from "react";
import { Box } from "@radix-ui/themes";
import Text from "@/ui/Text";
import AIRichTextField from "@/components/Markdown/AIRichTextField";
import { useSuggestHypothesis } from "@/components/Experiment/useSuggestHypothesis";

// The hypothesis box with the AI "Check hypothesis" button, as the new
// experiment modal has it.
export default function AIHypothesisField({
  label = "Hypothesis",
  value,
  onChange,
  onBlur,
  trackingSource,
  onUploadingChange,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  // Once focus leaves the field, not when it moves to its own button.
  onBlur?: () => void;
  trackingSource: string;
  // An image still uploading would be dropped from the saved hypothesis.
  onUploadingChange: (uploading: boolean) => void;
}) {
  const labelId = useId();
  const suggestHypothesis = useSuggestHypothesis(value, trackingSource);

  return (
    <Box
      mb="3"
      onBlur={
        onBlur
          ? (e) => {
              if (!e.currentTarget.contains(e.relatedTarget)) onBlur();
            }
          : undefined
      }
    >
      <Box id={labelId} mb="1">
        <Text as="label" weight="semibold">
          {label}
        </Text>
      </Box>
      <AIRichTextField
        value={value}
        onChange={onChange}
        placeholder="e.g. Making the signup button bigger will increase clicks and ultimately improve revenue"
        height="xs"
        collapsibleToolbar
        aiSuggestFunction={suggestHypothesis}
        aiButtonText="Check hypothesis"
        trackingSource={trackingSource}
        onUploadingChange={onUploadingChange}
        ariaLabelledBy={labelId}
      />
    </Box>
  );
}

import { useState } from "react";
import clsx from "clsx";
import { Box, Flex, TextArea } from "@radix-ui/themes";
import Button from "@/ui/Button";
import HelperText from "@/ui/HelperText";
import styles from "./PlainCommentBox.module.scss";

// A plain comment box: a fixed-height text area with a secondary Discard and
// a primary action inside it, bottom right. No write/preview tabs, uploads
// or footer. Used by the experiment Setup page's rail, both for new comments
// and for editing one (DiscussionThread's compact mode), so the two look the
// same.
//
// FALLBACK: Radix TextArea, used directly. @/ui/ has no text area component.
export default function PlainCommentBox({
  value,
  onChange,
  onSubmit,
  onDiscard,
  cta,
  discardLabel = "Discard",
  autoFocus = false,
  discardAlwaysEnabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  // Throw to show an error under the box.
  onSubmit: () => Promise<void>;
  onDiscard: () => void;
  cta: string;
  // The secondary button's label. "Cancel" when editing an existing comment.
  discardLabel?: string;
  autoFocus?: boolean;
  // Discard normally needs something to discard. When editing, it cancels
  // the edit, so it's always available.
  discardAlwaysEnabled?: boolean;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!value.trim() || saving) return;
    setError(null);
    setSaving(true);
    try {
      await onSubmit();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the comment.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Box>
      <Box style={{ position: "relative" }}>
        <TextArea
          // The Setup page's hover outline, like the Hypothesis field (set in
          // review).
          className={clsx(styles.textArea, styles.hoverOutline)}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            // Cmd/Ctrl+Enter submits, as in most comment boxes.
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void submit();
            }
          }}
          autoFocus={autoFocus}
          placeholder="Add a comment..."
          aria-label="Comment"
          // Fixed 136px, set in review; not resizable, which would fight the
          // fixed height. Room at the bottom for the buttons, so text never
          // runs under them.
          style={{ height: 136, resize: "none", paddingBottom: 36 }}
        />
        <Flex
          gap="2"
          style={{
            position: "absolute",
            right: "var(--space-2)",
            bottom: "var(--space-2)",
          }}
        >
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setError(null);
              onDiscard();
            }}
            disabled={saving || (!discardAlwaysEnabled && !value)}
          >
            {discardLabel}
          </Button>
          <Button
            size="sm"
            onClick={submit}
            loading={saving}
            disabled={!value.trim()}
          >
            {cta}
          </Button>
        </Flex>
      </Box>
      {error ? (
        <Box mt="1">
          <HelperText status="error">{error}</HelperText>
        </Box>
      ) : null}
    </Box>
  );
}

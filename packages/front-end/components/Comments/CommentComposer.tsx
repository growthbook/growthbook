import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import LoadingOverlay from "@/components/LoadingOverlay";
import RichTextEditor, { RichTextHeight } from "@/ui/RichTextEditor";
import Button from "@/ui/Button";
import HelperText from "@/ui/HelperText";

export interface CommentComposerProps {
  /**
   * Async submission handler. Receives the composer's current value and
   * should throw to surface an error message inline. The composer manages
   * its own loading and error state.
   */
  onSubmit: (value: string) => Promise<void>;
  cta?: string;
  placeholder?: string;
  initialValue?: string;
  autofocus?: boolean;
  // When autofocus is set, drop the caret at the end of `initialValue`
  // rather than the start — useful when seeding boilerplate the user
  // should type after.
  autofocusAtEnd?: boolean;
  onCancel?: () => void;
  /** Resting height; the editor grows with the text up to `maxHeight`. */
  height?: RichTextHeight;
  maxHeight?: RichTextHeight;
}

/**
 * Shared comment composer used by `DiscussionThread` (via `CommentForm`) and
 * `ReviewAndPublish`. Wraps the rich text editor in a form with internal
 * value/loading/error state. The caller only needs to provide the network
 * call via `onSubmit`. Formatting starts out of the way: most comments are a
 * sentence, so the ribbon waits behind its button.
 */
export default function CommentComposer({
  onSubmit,
  cta = "Comment",
  placeholder,
  initialValue = "",
  autofocus,
  autofocusAtEnd,
  onCancel,
  height = "sm",
  maxHeight,
}: CommentComposerProps) {
  const [value, setValue] = useState(initialValue);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (loading || value.trim().length < 1) return;
        setLoading(true);
        setError(null);
        try {
          await onSubmit(value);
          setValue("");
        } catch (err) {
          setError((err as Error).message || "Error saving comment");
        } finally {
          setLoading(false);
        }
      }}
    >
      {loading && <LoadingOverlay />}
      <RichTextEditor
        value={value}
        onChange={setValue}
        placeholder={placeholder}
        size="sm"
        height={height}
        autoGrow={!!maxHeight}
        maxHeight={maxHeight}
        autoFocus={autofocus}
        autoFocusAtEnd={autofocusAtEnd}
        simpleToolbar
        collapsibleToolbar
      />
      {/* Left aligned: the bottom-right corner belongs to the help launcher. */}
      <Flex align="center" mt="3" gap="2">
        {cta ? (
          <Button type="submit" disabled={value.trim().length < 1}>
            {cta}
          </Button>
        ) : null}
        {onCancel ? (
          <Button variant="ghost" color="gray" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        {error ? (
          <HelperText status="error" size="sm">
            {error}
          </HelperText>
        ) : null}
      </Flex>
    </form>
  );
}

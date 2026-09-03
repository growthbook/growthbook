import { useState } from "react";
import LoadingOverlay from "@/components/LoadingOverlay";
import MarkdownInput from "@/components/Markdown/MarkdownInput";

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
}

/**
 * Shared markdown comment composer used by `DiscussionThread` (via
 * `CommentForm`) and `ReviewAndPublish`. Wraps `MarkdownInput` in a form
 * with internal value/loading/error state. The caller only needs to
 * provide the network call via `onSubmit`.
 */
export default function CommentComposer({
  onSubmit,
  cta = "Comment",
  placeholder,
  initialValue = "",
  autofocus,
  autofocusAtEnd,
  onCancel,
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
      <MarkdownInput
        value={value}
        setValue={setValue}
        autofocus={autofocus}
        autofocusAtEnd={autofocusAtEnd}
        cta={cta}
        ctaDisabled={value.trim().length < 1}
        onCancel={onCancel}
        error={error || ""}
        placeholder={placeholder}
      />
    </form>
  );
}

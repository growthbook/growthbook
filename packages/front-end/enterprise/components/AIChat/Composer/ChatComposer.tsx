import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useState,
} from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import TextNode from "@tiptap/extension-text";
import HardBreak from "@tiptap/extension-hard-break";
import { Placeholder, UndoRedo } from "@tiptap/extensions";
import { Flex } from "@radix-ui/themes";
import { PiArrowRightBold, PiStop } from "react-icons/pi";
import Button from "@/ui/Button";
import { editorToText, textToContent } from "./serialize";
import styles from "./ChatComposer.module.scss";

/**
 * Imperative handle for refocusing a live editor — after a turn finishes, on
 * conversation switch, and on new chat. Focusing on mount is `autoFocus`
 * instead, which Tiptap applies itself once the view exists.
 */
export interface ChatComposerHandle {
  focus: () => void;
}

export interface ChatComposerProps {
  value: string;
  /** Must be referentially stable — Tiptap binds this once, when the editor is created. */
  onChange: (value: string) => void;
  onSend: () => void;
  onCancel: () => void;
  loading: boolean;
  isLocalStream: boolean;
  /** Read once, when the editor is created — Tiptap freezes extension options there. */
  placeholder?: string;
  /** Focus once the editor mounts. Later refocusing goes through the ref. */
  autoFocus?: boolean;
  /**
   * "wide" (default) is the centered, max-width layout used by the PA Explorer
   * chat. "compact" is a unified rounded composer tuned for the narrow
   * site-wide agent panel.
   */
  variant?: "wide" | "compact";
}

function ChatComposer(
  {
    value,
    onChange,
    onSend,
    onCancel,
    loading,
    isLocalStream,
    placeholder = "Ask about metrics, experiments, or setup...",
    autoFocus = false,
    variant = "wide",
  }: ChatComposerProps,
  ref: React.ForwardedRef<ChatComposerHandle>,
) {
  const [focused, setFocused] = useState(false);

  const editor = useEditor({
    // Next renders this on the server first; deferring the first render keeps
    // the client markup from mismatching.
    immediatelyRender: false,
    // Tiptap applies this itself in a deferred tick once the view exists,
    // which is the only reliable moment to focus a not-yet-created editor.
    autofocus: autoFocus ? "end" : false,
    extensions: [
      Document,
      Paragraph,
      TextNode,
      HardBreak,
      UndoRedo,
      Placeholder.configure({
        placeholder,
        // The editor is read-only while streaming, but the placeholder should
        // stay visible then, as it did on the disabled textarea.
        showOnlyWhenEditable: false,
      }),
    ],
    content: textToContent(value),
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": "Chat message",
      },
      handleKeyDown: (_view, event) => {
        // Enter sends; Shift+Enter falls through to HardBreak's own shortcut.
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          if (!loading) onSend();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: e }) => onChange(editorToText(e)),
  });

  useImperativeHandle(
    ref,
    () => ({ focus: () => editor?.commands.focus("end") }),
    [editor],
  );

  // The chat hook owns `value` and clears it on send, so mirror external
  // changes back into the document. Comparing first keeps this from clobbering
  // the caret on every keystroke we ourselves emitted.
  useEffect(() => {
    if (!editor || editorToText(editor) === value) return;
    editor.commands.setContent(textToContent(value), { emitUpdate: false });
  }, [editor, value]);

  useEffect(() => {
    editor?.setEditable(!loading);
  }, [editor, loading]);

  const handleFocus = useCallback(() => setFocused(true), []);
  const handleBlur = useCallback(() => setFocused(false), []);

  const canSend = value.trim().length > 0 && !loading;
  const isCompact = variant === "compact";

  // Mid-stream the button cancels instead of sending. Cancel is a neutral soft
  // chip so it doesn't read as a second primary CTA next to Send.
  const Icon = isLocalStream ? PiStop : PiArrowRightBold;
  const action = isLocalStream
    ? { onClick: onCancel, label: "Cancel generation", disabled: false }
    : { onClick: onSend, label: "Send message", disabled: !canSend };

  // Each variant keeps its own control so the button dimensions stay exactly as
  // designed: a 30x30 chip in the narrow panel, a `@/ui/Button` in the wide bar.
  const sendButton = isCompact ? (
    <button
      type="button"
      className={`${styles.sendButton}${isLocalStream ? ` ${styles.stopButton}` : ""}`}
      onClick={action.onClick}
      disabled={action.disabled}
      title={action.label}
      aria-label={action.label}
    >
      <Icon size={16} />
    </button>
  ) : (
    <Button
      className={styles.wideSendButton}
      color={isLocalStream ? "gray" : "violet"}
      variant={isLocalStream ? "soft" : "solid"}
      onClick={action.onClick}
      disabled={action.disabled}
      title={action.label}
      aria-label={action.label}
    >
      <Icon size={16} />
    </Button>
  );

  const boxClass = isCompact ? styles.compactBox : styles.wideBox;
  const boxFocusClass = isCompact
    ? styles.compactBoxFocused
    : styles.wideBoxFocused;

  const box = (
    <div
      className={`${styles.box} ${boxClass}${focused ? ` ${boxFocusClass}` : ""}`}
    >
      <EditorContent
        editor={editor}
        className={`${styles.editor}${loading ? ` ${styles.readOnly}` : ""}`}
        onFocus={handleFocus}
        onBlur={handleBlur}
      />
      {sendButton}
    </div>
  );

  if (isCompact) {
    return <div className={styles.compactWrapper}>{box}</div>;
  }

  return (
    <Flex justify="center" py="5" px="9" className={styles.wideWrapper}>
      {box}
    </Flex>
  );
}

export default forwardRef(ChatComposer);

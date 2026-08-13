import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import TextNode from "@tiptap/extension-text";
import HardBreak from "@tiptap/extension-hard-break";
import { Placeholder, UndoRedo } from "@tiptap/extensions";
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
  onChange: (value: string) => void;
  onSend: () => void;
  onCancel: () => void;
  loading: boolean;
  isLocalStream: boolean;
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

  // Editor options are captured once at creation, so the handlers it calls
  // read through refs to stay current without recreating the editor (which
  // would drop the caret and any in-progress text).
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onSendRef = useRef(onSend);
  onSendRef.current = onSend;
  const placeholderRef = useRef(placeholder);
  placeholderRef.current = placeholder;
  const loadingRef = useRef(loading);
  loadingRef.current = loading;

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
        placeholder: () => placeholderRef.current,
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
          if (!loadingRef.current) onSendRef.current();
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: e }) => onChangeRef.current(editorToText(e)),
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

  // Mid-stream the button cancels instead of sending; everything else about it
  // is identical, so resolve the action once rather than per variant.
  const Icon = isLocalStream ? PiStop : PiArrowRightBold;
  const action = isLocalStream
    ? { onClick: onCancel, label: "Cancel generation", disabled: false }
    : { onClick: onSend, label: "Send message", disabled: !canSend };

  const sendButton = isCompact ? (
    <button
      type="button"
      className={`${styles.sendButton}${isLocalStream ? ` ${styles.stopButton}` : ""}`}
      onClick={action.onClick}
      disabled={action.disabled}
      title={action.label}
      aria-label={action.label}
    >
      <Icon size={15} />
    </button>
  ) : (
    <Button
      className={styles.wideSendButton}
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

  return (
    <div className={isCompact ? styles.compactWrapper : styles.wideWrapper}>
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
    </div>
  );
}

export default forwardRef(ChatComposer);

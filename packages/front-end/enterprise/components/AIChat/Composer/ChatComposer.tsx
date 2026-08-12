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
 * Imperative handle for the parents, which focus the composer on open, on
 * conversation switch, and when a turn finishes.
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

  // `immediatelyRender: false` means the editor is null for the first commit,
  // so a mount-time focus() from a parent would otherwise be dropped. Park it
  // and apply it as soon as the editor exists.
  const pendingFocusRef = useRef(false);
  useImperativeHandle(
    ref,
    () => ({
      focus: () => {
        if (editor) editor.commands.focus("end");
        else pendingFocusRef.current = true;
      },
    }),
    [editor],
  );

  useEffect(() => {
    if (!editor || !pendingFocusRef.current) return;
    pendingFocusRef.current = false;
    editor.commands.focus("end");
  }, [editor]);

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

  const editorNode = (
    <EditorContent
      editor={editor}
      className={`${styles.editor}${loading ? ` ${styles.readOnly}` : ""} ${
        variant === "compact" ? styles.compactEditor : styles.wideEditor
      }`}
      onFocus={handleFocus}
      onBlur={handleBlur}
    />
  );

  if (variant === "compact") {
    return (
      <div className={styles.compactWrapper}>
        <div
          className={`${styles.composer}${focused ? ` ${styles.composerFocused}` : ""}`}
        >
          {editorNode}
          {isLocalStream ? (
            <button
              type="button"
              className={`${styles.sendButton} ${styles.stopButton}`}
              onClick={onCancel}
              title="Cancel generation"
              aria-label="Cancel generation"
            >
              <PiStop size={15} />
            </button>
          ) : (
            <button
              type="button"
              className={styles.sendButton}
              onClick={onSend}
              disabled={!canSend}
              title="Send message"
              aria-label="Send message"
            >
              <PiArrowRightBold size={15} />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wideWrapper}>
      <div
        className={`${styles.wideField}${focused ? ` ${styles.wideFieldFocused}` : ""}`}
      >
        {editorNode}
      </div>
      {isLocalStream ? (
        <Button onClick={onCancel} title="Cancel generation">
          <PiStop size={16} />
        </Button>
      ) : (
        <Button onClick={onSend} disabled={!canSend}>
          <PiArrowRightBold size={16} />
        </Button>
      )}
    </div>
  );
}

export default forwardRef(ChatComposer);

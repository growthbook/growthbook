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
import type { AIChatMention } from "shared/ai-chat";
import Button from "@/ui/Button";
import { collectMentions, editorToText, textToContent } from "./serialize";
import {
  MetricMention,
  METRIC_MENTION_NAME,
  filterMentionItems,
  type MentionItem,
} from "./extensions/metricMention";
import MentionList from "./MentionList";
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
  /** Receives the entities @-mentioned in the message being sent. */
  onSend: (mentions: AIChatMention[]) => void;
  onCancel: () => void;
  loading: boolean;
  isLocalStream: boolean;
  /**
   * Unavailable rather than busy — e.g. AI is switched off for the org. Blocks
   * typing and sending, independently of `loading`.
   */
  disabled?: boolean;
  /** Minimum visible rows. Only meaningful for the tall `hero` variant. */
  minRows?: number;
  placeholder?: string;
  /** Focus once the editor mounts. Later refocusing goes through the ref. */
  autoFocus?: boolean;
  /**
   * "wide" (default) is the centered, max-width bar used by the PA Explorer
   * chat, "compact" the rounded composer in the narrow site-wide agent panel,
   * and "hero" the tall entry composer on the PA empty state.
   */
  variant?: "wide" | "compact" | "hero";
  /**
   * Metrics offered by the `@` menu. Safe to arrive late or change — it is read
   * through the extension's storage, not captured at editor creation.
   */
  mentionItems?: MentionItem[];
}

function ChatComposer(
  {
    value,
    onChange,
    onSend,
    onCancel,
    loading,
    isLocalStream,
    disabled = false,
    minRows,
    placeholder = "Ask about metrics, experiments, or setup...",
    autoFocus = false,
    variant = "wide",
    mentionItems,
  }: ChatComposerProps,
  ref: React.ForwardedRef<ChatComposerHandle>,
) {
  const [focused, setFocused] = useState(false);
  // Populated by the suggestion plugin while an `@` query is active. Null means
  // no popup, which also lets Enter fall through to send.
  const [mention, setMention] = useState<{
    items: MentionItem[];
    command: (item: MentionItem) => void;
  } | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const mentionOpen = mention !== null && mention.items.length > 0;

  // `MentionItem` is shaped as the node's attrs, so the stock Mention `command`
  // can insert it directly.
  const selectMention = useCallback(
    (item: MentionItem) => mention?.command(item),
    [mention],
  );

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
      MetricMention.configure({
        suggestion: {
          char: "@",
          // Read from storage, not from a captured `mentionItems`, since the
          // metric list loads asynchronously after the editor is created.
          items: ({ query, editor: e }) =>
            filterMentionItems(e.storage[METRIC_MENTION_NAME].items, query),
          render: () => ({
            onStart: (props) => {
              setMention({ items: props.items, command: props.command });
              setMentionIndex(0);
            },
            onUpdate: (props) => {
              setMention({ items: props.items, command: props.command });
              setMentionIndex(0);
            },
            onExit: () => setMention(null),
          }),
        },
      }),
    ],
    content: textToContent(value),
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": "Chat message",
      },
      handleKeyDown: (view, event) => {
        // ProseMirror consults `editorProps` BEFORE plugin props, so while the
        // mention popup is open its navigation keys have to be claimed here —
        // otherwise Enter would send the message instead of picking a metric.
        if (mentionOpen && mention) {
          const count = mention.items.length;
          if (event.key === "ArrowDown") {
            setMentionIndex((i) => (i + 1) % count);
            return true;
          }
          if (event.key === "ArrowUp") {
            setMentionIndex((i) => (i - 1 + count) % count);
            return true;
          }
          if (event.key === "Enter" || event.key === "Tab") {
            selectMention(mention.items[mentionIndex] ?? mention.items[0]);
            return true;
          }
          // Escape is left alone — the suggestion plugin dispatches its own
          // exit for it, which fires `onExit` and clears the popup.
          return false;
        }
        // Enter sends; Shift+Enter falls through to HardBreak's own shortcut.
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          if (!loading && !disabled) onSend(collectMentions(view.state.doc));
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
    editor?.setEditable(!loading && !disabled);
  }, [editor, loading, disabled]);

  // Extension options are frozen at creation but the metric list arrives later
  // from `useDefinitions`, so it lives in the extension's storage — which the
  // suggestion `items` callback reads through the editor it is handed.
  useEffect(() => {
    if (!editor) return;
    editor.storage[METRIC_MENTION_NAME].items = mentionItems ?? [];
  }, [editor, mentionItems]);

  const handleFocus = useCallback(() => setFocused(true), []);
  const handleBlur = useCallback(() => setFocused(false), []);

  const submit = useCallback(() => {
    if (!editor) return;
    onSend(collectMentions(editor.state.doc));
  }, [editor, onSend]);

  const canSend = value.trim().length > 0 && !loading && !disabled;
  const isCompact = variant === "compact";
  const isHero = variant === "hero";

  // Mid-stream the button cancels instead of sending. Cancel is a neutral soft
  // chip so it doesn't read as a second primary CTA next to Send.
  const Icon = isLocalStream ? PiStop : PiArrowRightBold;
  const action = isLocalStream
    ? { onClick: onCancel, label: "Cancel generation", disabled: false }
    : { onClick: submit, label: "Send message", disabled: !canSend };

  // Each variant keeps its own control so the button dimensions stay exactly as
  // designed: a 30x30 chip in the narrow panel, a `@/ui/Button` elsewhere.
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

  const boxClasses = [
    styles.box,
    // Hero places its button absolutely; the others sit it beside the editor.
    isHero ? styles.heroBox : styles.inlineBox,
    isHero ? "" : isCompact ? styles.compactBox : styles.wideBox,
    focused
      ? isHero
        ? styles.heroBoxFocused
        : isCompact
          ? styles.compactBoxFocused
          : styles.wideBoxFocused
      : "",
  ].filter(Boolean);

  const box = (
    <div className={boxClasses.join(" ")}>
      {mentionOpen && mention && (
        <MentionList
          items={mention.items}
          activeIndex={mentionIndex}
          onSelect={selectMention}
        />
      )}
      <EditorContent
        editor={editor}
        className={`${styles.editor}${loading || disabled ? ` ${styles.readOnly}` : ""}`}
        // Rows are the caller's unit; 20px is the editor's line-height.
        style={minRows ? { minHeight: minRows * 20 } : undefined}
        onFocus={handleFocus}
        onBlur={handleBlur}
      />
      {isHero ? (
        <div className={styles.heroSendButton}>{sendButton}</div>
      ) : (
        sendButton
      )}
    </div>
  );

  if (isCompact) {
    return <div className={styles.compactWrapper}>{box}</div>;
  }

  if (isHero) return box;

  return (
    <Flex justify="center" py="5" px="9" className={styles.wideWrapper}>
      {box}
    </Flex>
  );
}

export default forwardRef(ChatComposer);

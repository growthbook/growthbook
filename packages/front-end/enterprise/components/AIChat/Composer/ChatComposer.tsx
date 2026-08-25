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
import { Flex } from "@radix-ui/themes";
import { PiArrowRightBold, PiStop } from "react-icons/pi";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { AIChatMention } from "shared/ai-chat";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import {
  collectMentions,
  collectSkills,
  docToText,
  editorToText,
  stripDanglingTriggers,
  textToContent,
} from "./serialize";
import {
  MetricMention,
  METRIC_MENTION_NAME,
  filterMentionItems,
  type MentionItem,
  type MentionStorage,
  mentionGroupLabel,
} from "./extensions/metricMention";
import {
  SkillCommand,
  SKILL_COMMAND_NAME,
  filterSkillItems,
  type SkillItem,
} from "./extensions/skillCommand";
import TokenHoverCard, {
  readHoveredToken,
  type HoveredToken,
} from "./TokenHoverCard";
import SuggestionList, {
  SUGGESTION_LISTBOX_ID,
  suggestionOptionId,
  type SuggestionRow,
} from "./SuggestionList";
import styles from "./ChatComposer.module.scss";

/** Focus a live editor — after a turn, conversation switch, or new chat. */
export interface ChatComposerHandle {
  focus: () => void;
}

export interface ComposerSubmission {
  text: string;
  mentions: AIChatMention[];
  skills: string[];
}

export interface ChatComposerProps {
  value: string;
  /** Tiptap binds this once, when the editor is created. */
  onChange: (value: string) => void;
  onSend: (payload: ComposerSubmission) => void;
  onCancel: () => void;
  loading: boolean;
  isLocalStream: boolean;
  disabled?: boolean;
  minRows?: number;
  placeholder?: string;
  autoFocus?: boolean;
  /** "wide" = PA chat, "compact" = agent panel, "hero" = PA empty state. */
  variant?: "wide" | "compact" | "hero";
  mentionItems?: MentionItem[];
  /** Until true, mentions aren't marked stale — the list may still be loading. */
  mentionItemsReady?: boolean;
  /** Omit to hide slash commands (PA chat has none). */
  skillItems?: SkillItem[];
}

type ActiveSuggestion =
  | {
      kind: "mention";
      items: MentionItem[];
      command: (item: MentionItem) => void;
    }
  | { kind: "skill"; items: SkillItem[]; command: (item: SkillItem) => void };

const HOVER_CARD_CLOSE_DELAY_MS = 200;

function tokenKey(hovered: HoveredToken | null): string | null {
  if (!hovered) return null;
  return hovered.token.kind === "mention"
    ? hovered.token.mention.id
    : hovered.token.skill;
}

function readSubmission(doc: ProseMirrorNode): ComposerSubmission {
  return {
    text: stripDanglingTriggers(docToText(doc)).trim(),
    mentions: collectMentions(doc),
    skills: collectSkills(doc),
  };
}

function toRows(suggestion: ActiveSuggestion): SuggestionRow[] {
  if (suggestion.kind === "mention") {
    return suggestion.items.map((item) => ({
      key: item.id,
      primary: item.label,
      groupLabel: mentionGroupLabel(item.metricType),
      secondary:
        item.metricType === "dashboard" ? undefined : (
          <Badge size="xs" variant="soft" label={item.typeLabel} />
        ),
    }));
  }
  return suggestion.items.map((item) => ({
    key: item.id,
    primary: item.title,
    secondary: item.description,
  }));
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
    mentionItemsReady = false,
    skillItems,
  }: ChatComposerProps,
  ref: React.ForwardedRef<ChatComposerHandle>,
) {
  const [focused, setFocused] = useState(false);
  const [suggestion, setSuggestion] = useState<ActiveSuggestion | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [hoveredToken, setHoveredToken] = useState<HoveredToken | null>(null);
  const rows = suggestion ? toRows(suggestion) : [];
  const suggestionVisible = suggestion !== null;
  const suggestionOpen = rows.length > 0;

  const hideCardTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelHideCard = useCallback(() => {
    if (hideCardTimer.current) {
      clearTimeout(hideCardTimer.current);
      hideCardTimer.current = null;
    }
  }, []);

  const scheduleHideCard = useCallback(() => {
    cancelHideCard();
    hideCardTimer.current = setTimeout(
      () => setHoveredToken(null),
      HOVER_CARD_CLOSE_DELAY_MS,
    );
  }, [cancelHideCard]);

  useEffect(() => cancelHideCard, [cancelHideCard]);

  const handleBoxMouseOver = useCallback(
    (event: React.MouseEvent) => {
      if (cardRef.current?.contains(event.target as Node)) {
        cancelHideCard();
        return;
      }
      const next = readHoveredToken(event.target, boxRef.current);
      if (!next) {
        scheduleHideCard();
        return;
      }
      cancelHideCard();
      setHoveredToken((prev) =>
        prev?.token.kind === next.token.kind &&
        tokenKey(prev) === tokenKey(next)
          ? prev
          : next,
      );
    },
    [cancelHideCard, scheduleHideCard],
  );

  const selectSuggestion = useCallback(
    (index: number) => {
      if (!suggestion) return;
      if (suggestion.kind === "mention") {
        const item = suggestion.items[index];
        if (item) suggestion.command(item);
      } else {
        const item = suggestion.items[index];
        if (item) suggestion.command(item);
      }
    },
    [suggestion],
  );

  const editor = useEditor({
    immediatelyRender: false,
    autofocus: autoFocus ? "end" : false,
    extensions: [
      Document,
      Paragraph,
      TextNode,
      HardBreak,
      UndoRedo,
      Placeholder.configure({
        placeholder,
        showOnlyWhenEditable: false,
      }),
      MetricMention.configure({
        suggestion: {
          char: "@",
          items: ({ query, editor: e }) =>
            filterMentionItems(e.storage[METRIC_MENTION_NAME].items, query),
          render: () => ({
            onStart: (props) => {
              setSuggestion({
                kind: "mention",
                items: props.items,
                command: props.command,
              });
              setActiveIndex(0);
            },
            onUpdate: (props) => {
              setSuggestion({
                kind: "mention",
                items: props.items,
                command: props.command,
              });
              setActiveIndex(0);
            },
            onExit: () => setSuggestion(null),
          }),
        },
      }),
      SkillCommand.configure({
        suggestion: {
          char: "/",
          // Space or start of line, so a URL doesn't open the menu.
          allowedPrefixes: [" "],
          startOfLine: false,
          items: ({ query, editor: e }) =>
            filterSkillItems(e.storage[SKILL_COMMAND_NAME].items, query),
          command: ({ editor: e, range, props }) => {
            e.chain()
              .focus()
              .insertContentAt(range, [
                {
                  type: SKILL_COMMAND_NAME,
                  attrs: {
                    id: props.id,
                    label: props.label,
                    // Mention nodes default to "@"; this is what renderText prefixes with.
                    mentionSuggestionChar: "/",
                  },
                },
                { type: "text", text: " " },
              ])
              .run();
          },
          render: () => ({
            onStart: (props) => {
              setSuggestion({
                kind: "skill",
                items: props.items,
                command: props.command,
              });
              setActiveIndex(0);
            },
            onUpdate: (props) => {
              setSuggestion({
                kind: "skill",
                items: props.items,
                command: props.command,
              });
              setActiveIndex(0);
            },
            onExit: () => setSuggestion(null),
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
        ...(suggestionVisible
          ? {
              "aria-expanded": "true",
              "aria-controls": SUGGESTION_LISTBOX_ID,
              ...(suggestionOpen
                ? { "aria-activedescendant": suggestionOptionId(activeIndex) }
                : {}),
            }
          : {}),
      },
      handleKeyDown: (view, event) => {
        // editorProps run before plugin props, so claim these while the popup is open.
        if (suggestionOpen) {
          const count = rows.length;
          if (event.key === "ArrowDown") {
            setActiveIndex((i) => (i + 1) % count);
            return true;
          }
          if (event.key === "ArrowUp") {
            setActiveIndex((i) => (i - 1 + count) % count);
            return true;
          }
          if (event.key === "Enter" || event.key === "Tab") {
            selectSuggestion(activeIndex < count ? activeIndex : 0);
            return true;
          }
          return false;
        }
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          if (!loading && !disabled) onSend(readSubmission(view.state.doc));
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

  useEffect(() => {
    if (!editor || editorToText(editor) === value) return;
    editor.commands.setContent(textToContent(value), { emitUpdate: false });
  }, [editor, value]);

  useEffect(() => {
    editor?.setEditable(!loading && !disabled);
  }, [editor, loading, disabled]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const storage = editor.storage[METRIC_MENTION_NAME] as MentionStorage;
    storage.items = mentionItems ?? [];
    storage.ready = mentionItemsReady;
    // Empty transaction: storage isn't reactive, but decorations recompute on a new state.
    editor.view.dispatch(editor.state.tr.setMeta("addToHistory", false));
  }, [editor, mentionItems, mentionItemsReady]);

  useEffect(() => {
    if (!editor) return;
    editor.storage[SKILL_COMMAND_NAME].items = skillItems ?? [];
  }, [editor, skillItems]);

  const handleFocus = useCallback(() => setFocused(true), []);
  const handleBlur = useCallback(() => setFocused(false), []);

  const submit = useCallback(() => {
    if (!editor) return;
    onSend(readSubmission(editor.state.doc));
  }, [editor, onSend]);

  const canSend = value.trim().length > 0 && !loading && !disabled;
  const isCompact = variant === "compact";
  const isHero = variant === "hero";

  const Icon = isLocalStream ? PiStop : PiArrowRightBold;
  const action = isLocalStream
    ? { onClick: onCancel, label: "Cancel generation", disabled: false }
    : { onClick: submit, label: "Send message", disabled: !canSend };

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
    <div
      ref={boxRef}
      className={boxClasses.join(" ")}
      onMouseOver={handleBoxMouseOver}
      onMouseLeave={scheduleHideCard}
    >
      <TokenHoverCard hovered={hoveredToken} cardRef={cardRef} />
      {suggestionVisible && suggestion && (
        <SuggestionList
          items={rows}
          activeIndex={activeIndex}
          onSelect={selectSuggestion}
          ariaLabel={suggestion.kind === "mention" ? "Metrics" : "Skills"}
          emptyLabel={
            suggestion.kind === "mention"
              ? "No matching metrics"
              : "No matching skills"
          }
        />
      )}
      <EditorContent
        editor={editor}
        className={`${styles.editor}${loading || disabled ? ` ${styles.readOnly}` : ""}`}
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

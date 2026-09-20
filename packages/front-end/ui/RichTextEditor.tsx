import {
  forwardRef,
  MutableRefObject,
  Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import clsx from "clsx";
import { CodeHighlightNode, CodeNode } from "@lexical/code";
import { LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  TRANSFORMERS,
} from "@lexical/markdown";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import type { EditorState } from "lexical";
import { Size } from "@/ui/sizes";
import styles from "./RichTextEditor.module.scss";

export interface RichTextEditorHandle {
  /** The editor's current content, as markdown. */
  getMarkdown: () => string;
  /** Replace the content. Use for anything that writes over what's there. */
  setMarkdown: (markdown: string) => void;
  focus: () => void;
}

export interface Props {
  /** Markdown in, markdown out: the stored format never changes. */
  value: string;
  onChange?: (markdown: string) => void;
  /** Fired with the current markdown once focus leaves, for save-on-blur. */
  onBlur?: (markdown: string) => void;
  placeholder?: string;
  size?: Size<"sm" | "md">;
  /** Height of the editable area. A number is px; a string passes through. */
  height?: number | string;
  /** Grow past `height` with the content instead of scrolling. */
  autoGrow?: boolean;
  readOnly?: boolean;
  autoFocus?: boolean;
  className?: string;
  id?: string;
}

/** The node types the editor understands. Anything else is dropped on paste. */
const NODES = [
  HeadingNode,
  QuoteNode,
  ListNode,
  ListItemNode,
  LinkNode,
  CodeNode,
  CodeHighlightNode,
];

const THEME = {
  paragraph: styles.paragraph,
  quote: styles.quote,
  link: styles.link,
  heading: {
    h1: styles.h1,
    h2: styles.h2,
    h3: styles.h3,
    h4: styles.h4,
    h5: styles.h5,
    h6: styles.h6,
  },
  list: {
    ul: styles.ul,
    ol: styles.ol,
    listitem: styles.li,
    nested: { listitem: styles.nestedLi },
  },
  text: {
    bold: styles.bold,
    italic: styles.italic,
    strikethrough: styles.strikethrough,
    code: styles.inlineCode,
  },
  code: styles.codeBlock,
};

/** Exposes the editor to the parent, and keeps `readOnly` in step. */
function EditorBridge({
  handleRef,
  readOnly,
  autoFocus,
  lastMarkdown,
}: {
  handleRef: Ref<RichTextEditorHandle>;
  readOnly: boolean;
  autoFocus: boolean;
  lastMarkdown: MutableRefObject<string>;
}) {
  const [editor] = useLexicalComposerContext();

  useImperativeHandle(
    handleRef,
    () => ({
      getMarkdown: () =>
        editor
          .getEditorState()
          .read(() => $convertToMarkdownString(TRANSFORMERS)),
      setMarkdown: (markdown: string) => {
        editor.update(() => {
          $convertFromMarkdownString(markdown, TRANSFORMERS);
        });
        lastMarkdown.current = markdown;
      },
      focus: () => editor.focus(),
    }),
    [editor, lastMarkdown],
  );

  useEffect(() => {
    editor.setEditable(!readOnly);
  }, [editor, readOnly]);

  useEffect(() => {
    if (autoFocus && !readOnly) editor.focus();
    // Only on mount: refocusing whenever the flag is recomputed would steal
    // the caret back from whatever the user moved to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

/** Applies `value` when it changes underneath us, e.g. an AI suggestion. */
function ValueSync({
  value,
  lastMarkdown,
}: {
  value: string;
  lastMarkdown: MutableRefObject<string>;
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (value === lastMarkdown.current) return;
    lastMarkdown.current = value;
    editor.update(() => {
      $convertFromMarkdownString(value, TRANSFORMERS);
    });
  }, [value, editor, lastMarkdown]);

  return null;
}

/**
 * A rich text field that reads and writes markdown.
 *
 * Lexical ships no styles, so everything here is ours: the surface, the node
 * classes in THEME, and the toolbar, which callers supply themselves.
 */
export default forwardRef<RichTextEditorHandle, Props>(function RichTextEditor(
  {
    value,
    onChange,
    onBlur,
    placeholder,
    size = "md",
    height = 120,
    autoGrow = false,
    readOnly = false,
    autoFocus = false,
    className,
    id,
  },
  ref,
) {
  // What the editor last held, so a value we emitted doesn't loop back in.
  const lastMarkdown = useRef(value);

  const handleChange = useCallback(
    (editorState: EditorState) => {
      editorState.read(() => {
        const markdown = $convertToMarkdownString(TRANSFORMERS);
        if (markdown === lastMarkdown.current) return;
        lastMarkdown.current = markdown;
        onChange?.(markdown);
      });
    },
    [onChange],
  );

  const handleBlur = useCallback(() => {
    onBlur?.(lastMarkdown.current);
  }, [onBlur]);

  return (
    <LexicalComposer
      initialConfig={{
        namespace: id || "rich-text-editor",
        nodes: NODES,
        theme: THEME,
        editable: !readOnly,
        editorState: () => $convertFromMarkdownString(value, TRANSFORMERS),
        onError: (error) => {
          throw error;
        },
      }}
    >
      <div
        className={clsx(
          styles.wrapper,
          styles[size],
          readOnly && styles.readOnly,
          className,
        )}
        onBlur={handleBlur}
      >
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              id={id}
              className={styles.editable}
              style={{
                height: autoGrow ? undefined : height,
                minHeight: autoGrow ? height : undefined,
              }}
              aria-placeholder={placeholder ?? ""}
              placeholder={
                placeholder ? (
                  <div className={styles.placeholder}>{placeholder}</div>
                ) : null
              }
            />
          }
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        <ListPlugin />
        <LinkPlugin />
        <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
        <OnChangePlugin ignoreSelectionChange onChange={handleChange} />
        <ValueSync value={value} lastMarkdown={lastMarkdown} />
        <EditorBridge
          handleRef={ref}
          readOnly={readOnly}
          autoFocus={autoFocus}
          lastMarkdown={lastMarkdown}
        />
      </div>
    </LexicalComposer>
  );
});

import {
  forwardRef,
  MutableRefObject,
  ReactNode,
  Ref,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import clsx from "clsx";
import { CodeHighlightNode, CodeNode } from "@lexical/code";
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
import { LinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import {
  $getRoot,
  $getSelection,
  $insertNodes,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  PASTE_COMMAND,
  type EditorState,
} from "lexical";
import { useDropzone } from "react-dropzone";
import { IconButton } from "@radix-ui/themes";
import { PiCaretDownBold, PiCaretUpBold } from "react-icons/pi";
import { useAuth } from "@/services/auth";
import { uploadFile } from "@/services/files";
import useOrgSettings from "@/hooks/useOrgSettings";
import { Size } from "@/ui/sizes";
import Tooltip from "@/ui/Tooltip";
import {
  $createImageNode,
  ImageNode,
  IMAGE_TRANSFORMER,
} from "./RichTextEditorImageNode";
import RichTextEditorToolbar from "./RichTextEditorToolbar";
import { hasMarkdownFormatting } from "./richTextFormatting";
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
  /** Resting height of the whole control, and its minimum when `autoGrow` is set. */
  height?: RichTextHeight;
  /** Grow past `height` with the content, up to `maxHeight`, instead of scrolling. */
  autoGrow?: boolean;
  /** Where growing stops and the content scrolls. Only applies with `autoGrow`. */
  maxHeight?: RichTextHeight | "none";
  readOnly?: boolean;
  autoFocus?: boolean;
  /** Drop or paste images to upload them. Off where uploads make no sense. */
  allowImageUpload?: boolean;
  /** Rendered under the editable area, for a caller's own controls. */
  footer?: ReactNode;
  /** Hide the formatting ribbon, e.g. for a one-line note. */
  hideToolbar?: boolean;
  /** The short ribbon: no headings, no strikethrough. */
  simpleToolbar?: boolean;
  /**
   * Start with the ribbon hidden behind a button in the corner, for a field
   * where formatting is the exception — a comment, say.
   */
  collapsibleToolbar?: boolean;
  /** Put the caret after the value rather than before it. */
  autoFocusAtEnd?: boolean;
  className?: string;
  id?: string;
}

/**
 * Heights of the whole control, toolbar included, on the shared size names.
 * One ladder serves both the resting height and the cap, so a field cannot be
 * given a mismatched pair.
 */
export const RICH_TEXT_HEIGHTS = {
  sm: 110,
  md: 150,
  lg: 220,
  xl: 360,
} as const;

export type RichTextHeight = keyof typeof RICH_TEXT_HEIGHTS;

/** The node types the editor understands. Anything else is dropped on paste. */
const NODES = [
  HeadingNode,
  QuoteNode,
  ListNode,
  ListItemNode,
  LinkNode,
  CodeNode,
  CodeHighlightNode,
  ImageNode,
];

/** Images first: their `![...]` would otherwise match as a link. */
const MARKDOWN_TRANSFORMERS = [IMAGE_TRANSFORMER, ...TRANSFORMERS];

const IMAGE_TYPES = "image/png, image/jpeg, image/gif";

function linkLabelFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || "Link";
  } catch {
    return "Link";
  }
}

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
  autoFocusAtEnd,
  lastMarkdown,
}: {
  handleRef: Ref<RichTextEditorHandle>;
  readOnly: boolean;
  autoFocus: boolean;
  autoFocusAtEnd: boolean;
  lastMarkdown: MutableRefObject<string>;
}) {
  const [editor] = useLexicalComposerContext();

  useImperativeHandle(
    handleRef,
    () => ({
      getMarkdown: () =>
        editor
          .getEditorState()
          .read(() => $convertToMarkdownString(MARKDOWN_TRANSFORMERS)),
      setMarkdown: (markdown: string) => {
        editor.update(() => {
          $convertFromMarkdownString(markdown, MARKDOWN_TRANSFORMERS);
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
    if (autoFocus && !readOnly) {
      editor.focus();
      // Seeded text the writer is meant to continue, rather than type in front of.
      if (autoFocusAtEnd) {
        editor.update(() => {
          $getRoot().selectEnd();
        });
      }
    }
    // Only on mount: refocusing whenever the flag is recomputed would steal
    // the caret back from whatever the user moved to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}

/**
 * Pasting: image files upload and become image nodes, and a bare URL becomes a
 * link rather than the URL's text.
 */
function PasteHandling({
  onFiles,
  allowImages,
}: {
  onFiles: (files: File[]) => void;
  allowImages: boolean;
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(
    () =>
      editor.registerCommand(
        PASTE_COMMAND,
        (event: ClipboardEvent) => {
          const data = event.clipboardData;
          if (!data) return false;

          const files = Array.from(data.files).filter((f) =>
            f.type.startsWith("image/"),
          );
          if (allowImages && files.length) {
            event.preventDefault();
            onFiles(files);
            return true;
          }

          const text = data.getData("text/plain").trim();
          if (!/^https?:\/\/\S+$/i.test(text)) return false;

          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return false;
          event.preventDefault();

          // With nothing selected there is no text to become the link, so
          // seed it from the URL the way the markdown editor does.
          if (selection.isCollapsed()) {
            selection.insertText(linkLabelFromUrl(text));
          }
          editor.dispatchCommand(TOGGLE_LINK_COMMAND, text);
          return true;
        },
        COMMAND_PRIORITY_LOW,
      ),
    [editor, onFiles, allowImages],
  );

  return null;
}

/** Hands the editor a way to drop uploaded images in at the caret. */
function useImageInsert() {
  const [editor] = useLexicalComposerContext();
  return useCallback(
    (images: { src: string; alt: string }[]) => {
      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;
        $insertNodes(images.map(({ src, alt }) => $createImageNode(src, alt)));
      });
    },
    [editor],
  );
}

/** Uploads dropped or pasted images, then inserts them. */
function ImageUploads({
  allowImages,
  setUploading,
  registerDrop,
}: {
  allowImages: boolean;
  setUploading: (uploading: boolean) => void;
  registerDrop: (handler: (files: File[]) => void) => void;
}) {
  const insertImages = useImageInsert();
  const { apiCall } = useAuth();

  const upload = useCallback(
    async (files: File[]) => {
      if (!allowImages || !files.length) return;
      setUploading(true);
      try {
        const uploaded = await Promise.all(
          files.map(async (file) => {
            const alt = file.name.replace(/[^a-zA-Z0-9_\-.\s]*/g, "");
            const { fileURL } = await uploadFile(apiCall, file);
            return { src: fileURL, alt };
          }),
        );
        insertImages(uploaded);
      } finally {
        setUploading(false);
      }
    },
    [allowImages, apiCall, insertImages, setUploading],
  );

  useEffect(() => registerDrop(upload), [registerDrop, upload]);

  return <PasteHandling onFiles={upload} allowImages={allowImages} />;
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
      $convertFromMarkdownString(value, MARKDOWN_TRANSFORMERS);
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
    height = "md",
    autoGrow = false,
    maxHeight = "lg",
    readOnly = false,
    autoFocus = false,
    allowImageUpload = true,
    footer,
    hideToolbar = false,
    simpleToolbar = false,
    collapsibleToolbar = false,
    autoFocusAtEnd = false,
    className,
    id,
  },
  ref,
) {
  // A collapsed toolbar opens on content that already uses it, so editing
  // formatted text starts with the formatting in reach.
  const [toolbarOpen, setToolbarOpen] = useState(
    () => !collapsibleToolbar || hasMarkdownFormatting(value ?? ""),
  );
  // What the editor last held, so a value we emitted doesn't loop back in.
  const lastMarkdown = useRef(value);
  const [uploading, setUploading] = useState(false);
  const { blockFileUploads } = useOrgSettings();
  const allowImages = allowImageUpload && !readOnly && !blockFileUploads;

  // The dropzone sits outside the composer, so it reaches the upload handler
  // through a ref rather than the editor context.
  const dropHandler = useRef<(files: File[]) => void>(() => undefined);
  const registerDrop = useCallback((handler: (files: File[]) => void) => {
    dropHandler.current = handler;
  }, []);

  const {
    getRootProps,
    getInputProps,
    open: openFilePicker,
  } = useDropzone({
    onDrop: (files: File[]) => dropHandler.current(files),
    noClick: true,
    noKeyboard: true,
    disabled: !allowImages,
    accept: IMAGE_TYPES,
  });

  const handleChange = useCallback(
    (editorState: EditorState) => {
      editorState.read(() => {
        const markdown = $convertToMarkdownString(MARKDOWN_TRANSFORMERS);
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
        editorState: () =>
          $convertFromMarkdownString(value, MARKDOWN_TRANSFORMERS),
        onError: (error) => {
          throw error;
        },
      }}
    >
      <div
        {...(allowImages
          ? // The dropzone roots itself as a button, which is neither true nor
            // stylable here: it would announce as one and take a pointer cursor.
            (getRootProps({
              role: "presentation",
            }) as React.HTMLAttributes<HTMLDivElement>)
          : {})}
        className={clsx(
          styles.wrapper,
          styles[size],
          readOnly && styles.readOnly,
          className,
        )}
        style={{
          height: autoGrow ? undefined : RICH_TEXT_HEIGHTS[height],
          minHeight: autoGrow ? RICH_TEXT_HEIGHTS[height] : undefined,
          maxHeight:
            autoGrow && maxHeight !== "none"
              ? RICH_TEXT_HEIGHTS[maxHeight]
              : undefined,
        }}
        onBlur={handleBlur}
      >
        {allowImages ? <input {...getInputProps()} /> : null}
        {readOnly || hideToolbar || !toolbarOpen ? null : (
          <RichTextEditorToolbar
            onPickImage={allowImages ? openFilePicker : undefined}
            simple={simpleToolbar}
            inset={collapsibleToolbar}
          />
        )}
        <div className={styles.editableWrap}>
          {!readOnly && !hideToolbar && collapsibleToolbar ? (
            <Tooltip
              content={toolbarOpen ? "Hide formatting" : "Show formatting"}
            >
              <IconButton
                type="button"
                size="1"
                variant="soft"
                color="gray"
                className={styles.toolbarToggle}
                aria-label={toolbarOpen ? "Hide formatting" : "Show formatting"}
                aria-expanded={toolbarOpen}
                // Keeps the caret where it is, so the ribbon acts on the
                // selection the writer already had.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setToolbarOpen((open) => !open)}
              >
                {toolbarOpen ? (
                  <PiCaretUpBold size={10} />
                ) : (
                  <PiCaretDownBold size={10} />
                )}
              </IconButton>
            </Tooltip>
          ) : null}
          <RichTextPlugin
            contentEditable={
              <ContentEditable
                id={id}
                className={styles.editable}
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
        </div>
        <HistoryPlugin />
        <ListPlugin />
        <LinkPlugin />
        <MarkdownShortcutPlugin transformers={MARKDOWN_TRANSFORMERS} />
        <OnChangePlugin ignoreSelectionChange onChange={handleChange} />
        <ImageUploads
          allowImages={allowImages}
          setUploading={setUploading}
          registerDrop={registerDrop}
        />
        <ValueSync value={value} lastMarkdown={lastMarkdown} />
        <EditorBridge
          handleRef={ref}
          readOnly={readOnly}
          autoFocus={autoFocus}
          autoFocusAtEnd={autoFocusAtEnd}
          lastMarkdown={lastMarkdown}
        />
        {uploading ? (
          <div className={styles.uploading}>Uploading\u2026</div>
        ) : null}
        {footer}
      </div>
    </LexicalComposer>
  );
});

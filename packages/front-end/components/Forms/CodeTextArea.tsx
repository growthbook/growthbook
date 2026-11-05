import dynamic from "next/dynamic";
import {
  type ComponentType,
  type ReactNode,
  useEffect,
  useState,
  useRef,
  createElement,
  useId,
} from "react";
import type { Ace } from "ace-builds";
import type { IAceEditorProps } from "react-ace";
import clsx from "clsx";
import { Flex, IconButton } from "@radix-ui/themes";
import Button from "@/ui/Button";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";
import { CursorData } from "@/components/Segments/SegmentForm";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import {
  CODE_FONT_SIZE,
  getAceCodeCss,
  getCodeTheme,
} from "@/components/SyntaxHighlighting/codeTheme";
import { darkCss } from "@/components/SyntaxHighlighting/darkColors";
import { CopyIcon, FullscreenIcon } from "@/ui/ActionIcons";
import Field, { FieldProps } from "./Field";
import styles from "./CodeTextArea.module.scss";

export type AceCompletion = {
  caption: string;
  value: string;
  meta: string;
  score: number;
};

interface AceEditorProps extends IAceEditorProps {
  completions?: AceCompletion[];
}

interface AceModule {
  config: { setModuleUrl: (path: string, url: string) => void };
  require: (path: string) => unknown;
  define: (
    name: string,
    deps: string[],
    factory: (
      require: (path: string) => unknown,
      exports: Record<string, unknown>,
    ) => void,
  ) => void;
}

interface AceTheme {
  cssClass: string;
  cssText: string;
}

interface AceDom {
  importCssString: (cssText: string, id: string, target?: boolean) => void;
}

interface LangTools {
  setCompleters: (completers: unknown[]) => void;
  addCompleter: (completer: unknown) => void;
}

const LIGHT_THEME = "textmate";
const DARK_THEME = "textmate_dark";

const AceEditor = dynamic(
  async () => {
    // Load ace first - other modules expect global `ace`
    const aceModule = await import("ace-builds/src-min-noconflict/ace");
    const ace = (aceModule as { default?: AceModule }).default ?? aceModule;
    if (typeof window !== "undefined") {
      (window as unknown as { ace: unknown }).ace = ace;
    }

    const [reactAce, jsonWorker, jsWorker, yamlWorker] = await Promise.all([
      import("react-ace"),
      import("ace-builds/src-min-noconflict/worker-json"),
      import("ace-builds/src-min-noconflict/worker-javascript"),
      import("ace-builds/src-min-noconflict/worker-yaml"),
      import("ace-builds/src-min-noconflict/ext-language_tools"),
      import("ace-builds/src-min-noconflict/ext-searchbox"),
      import("ace-builds/src-min-noconflict/mode-sql"),
      import("ace-builds/src-min-noconflict/mode-javascript"),
      // TypeScript mode is highlighting-only (its `createWorker` returns null),
      // so TS schemas don't get flagged by the JavaScript (JSHint) validator.
      import("ace-builds/src-min-noconflict/mode-typescript"),
      import("ace-builds/src-min-noconflict/mode-python"),
      import("ace-builds/src-min-noconflict/mode-yaml"),
      import("ace-builds/src-min-noconflict/mode-json"),
      // Highlighting-only modes (no worker).
      import("ace-builds/src-min-noconflict/mode-protobuf"),
      import("ace-builds/src-min-noconflict/mode-golang"),
      import("ace-builds/src-min-noconflict/mode-rust"),
      import("ace-builds/src-min-noconflict/theme-textmate"),
    ]);

    // Workers: raw-loader gives us source; create blob: URLs for Ace
    const toWorkerUrl = (mod: { default: string }) =>
      URL.createObjectURL(
        new Blob([mod.default], { type: "application/javascript" }),
      );
    const jsonWorkerUrl = toWorkerUrl(jsonWorker);
    const jsWorkerUrl = toWorkerUrl(jsWorker);
    const yamlWorkerUrl = toWorkerUrl(yamlWorker);

    const aceTyped = ace as AceModule;
    aceTyped.config.setModuleUrl("ace/mode/json_worker", jsonWorkerUrl);
    aceTyped.config.setModuleUrl("ace/mode/javascript_worker", jsWorkerUrl);
    aceTyped.config.setModuleUrl("ace/mode/yaml_worker", yamlWorkerUrl);

    // Ace leaves the rest of a line unstyled after 2,000 tokens, and a stored
    // condition or JSON value is often one minified line of far more
    (
      aceTyped.require("ace/tokenizer") as {
        Tokenizer: {
          prototype: { $setMaxTokenCount: (count: number) => void };
        };
      }
    ).Tokenizer.prototype.$setMaxTokenCount(100_000);

    const langTools = aceTyped.require("ace/ext/language_tools") as LangTools;

    // Dark is the light theme inverted, not a theme of its own.
    const light = aceTyped.require(`ace/theme/${LIGHT_THEME}`) as AceTheme;
    const darkClass = `${light.cssClass}-dark`;
    const darkCssText = darkCss(light.cssText).replaceAll(
      `.${light.cssClass}`,
      `.${darkClass}`,
    );
    aceTyped.define(
      `ace/theme/${DARK_THEME}`,
      ["require", "exports", "ace/lib/dom"],
      (require, exports) => {
        exports.isDark = true;
        exports.cssClass = darkClass;
        exports.cssText = darkCssText;
        (require("ace/lib/dom") as AceDom).importCssString(
          darkCssText,
          darkClass,
          false,
        );
      },
    );

    // Return a wrapper component that handles completions
    const AceEditorWithCompletions = (props: AceEditorProps) => {
      const { completions, onLoad, ...otherProps } = props;
      const [editor, setEditor] = useState<Ace.Editor | null>(null);

      const handleLoad = (editorInstance: Ace.Editor) => {
        setEditor(editorInstance);
        // Call the original onLoad if provided
        if (onLoad) {
          onLoad(editorInstance);
        }
      };

      // Update completions whenever they change
      useEffect(() => {
        if (editor) {
          // Clear existing completers and set up fresh one
          langTools.setCompleters([]);

          // Only add our custom completer if we have completions
          if (
            completions &&
            Array.isArray(completions) &&
            completions.length > 0
          ) {
            const customCompleter = {
              getCompletions: (
                editor: Ace.Editor,
                session: Ace.EditSession,
                pos: Ace.Position,
                prefix: string,
                callback: (err: unknown, results: AceCompletion[]) => void,
              ) => {
                const filteredCompletions = completions.filter(
                  (completion: AceCompletion) => {
                    if (!prefix || prefix.trim() === "") {
                      return true;
                    }

                    const lowerPrefix = prefix.toLowerCase();
                    const lowerValue = completion.value.toLowerCase();
                    const lowerCaption = completion.caption.toLowerCase();

                    const checkParts = (text: string) => {
                      if (text.includes(".")) {
                        return text
                          .split(".")
                          .some((part) => part.startsWith(lowerPrefix));
                      }
                      return text.startsWith(lowerPrefix);
                    };

                    // Safety net - if the value is empty, don't show it
                    // This can happen for Data Sources that don't support all 3 levels (db, schema, table) like MySQL & Clickhouse
                    if (lowerValue === "") {
                      return false;
                    }

                    return checkParts(lowerValue) || checkParts(lowerCaption);
                  },
                );

                callback(null, filteredCompletions);
              },
              identifierRegexps: [/[a-zA-Z_0-9{]/],
            };

            langTools.addCompleter(customCompleter);
          }
        }
      }, [editor, completions]); // Depend on both editor and completions

      return createElement(
        (reactAce as { default: ComponentType<IAceEditorProps> }).default,
        { ...otherProps, onLoad: handleLoad },
      );
    };

    AceEditorWithCompletions.displayName = "AceEditorWithCompletions";

    return AceEditorWithCompletions;
  },
  {
    ssr: false,
  },
);

export type Language =
  | "sql"
  | "json"
  | "javascript"
  | "typescript"
  | "python"
  | "yml"
  | "protobuf"
  | "golang"
  | "rust";

export const FIVE_LINES_HEIGHT = 97;
export const TEN_LINES_HEIGHT = 194;

type CodeTextAreaFieldProps = Omit<
  FieldProps,
  | "value"
  | "onChange"
  | "options"
  | "multi"
  | "initialOption"
  | "render"
  | "ref"
>;

export type Props = CodeTextAreaFieldProps & {
  language: Language;
  value: string;
  setValue: (value: string) => void;
  setCursorData?: (data: CursorData) => void;
  minLines?: number;
  maxLines?: number;
  paddingTop?: number;
  // Hide the fold-widget caret so the line-number gutter is as narrow as
  // possible — useful for cramped inline editors (e.g. feature/config values).
  slimGutter?: boolean;
  fullHeight?: boolean;
  onCtrlEnter?: () => void;
  onFormatShortcut?: () => void;
  wrapperClassName?: string;
  completions?: AceCompletion[];
  resizable?: boolean;
  defaultHeight?: number;
  showCopyButton?: boolean;
  showFullscreenButton?: boolean;
  // When set, the in-editor fullscreen button calls this instead of toggling
  // CodeTextArea's own fullscreen — lets a parent own a custom fullscreen view.
  onRequestFullscreen?: () => void;
  // Exposes the underlying Ace editor once loaded, so a parent can do cursor-
  // aware edits (e.g. inserting a token at the cursor).
  onEditorLoad?: (editor: Ace.Editor) => void;
  // A value's editor: framed like the value's display, with quieter chrome (no
  // print margin, cursor line only while focused, scrollbars only on hover).
  matchValueDisplay?: boolean;
  // 1-based lines to highlight, marking fields that differ from sibling values.
  highlightLines?: number[];
  // More `EditorAction`s, shown before copy and fullscreen.
  actions?: ReactNode;
};

// Ace re-wraps a line on every edit, so wrapping one this long (minified JSON)
// makes typing lag; such text scrolls sideways instead.
const MAX_WRAPPED_LINE = 10_000;

function hasLongLine(text: string): boolean {
  if (text.length <= MAX_WRAPPED_LINE) return false;
  let start = 0;
  while (start < text.length) {
    const end = text.indexOf("\n", start);
    const stop = end === -1 ? text.length : end;
    if (stop - start > MAX_WRAPPED_LINE) return true;
    start = stop + 1;
  }
  return false;
}

// An icon button in the editor's corner, beside copy and fullscreen.
export function EditorAction({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <Tooltip body={label}>
      <IconButton
        type="button"
        radius="full"
        variant="ghost"
        aria-label={label}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onClick();
        }}
        style={{ position: "relative", zIndex: 1000 }}
      >
        {icon}
      </IconButton>
    </Tooltip>
  );
}

type AceRange = new (
  startRow: number,
  startColumn: number,
  endRow: number,
  endColumn: number,
) => Ace.Range;

export default function CodeTextArea({
  language,
  value,
  setValue,
  placeholder,
  minLines = 10,
  maxLines = 50,
  paddingTop = 0,
  slimGutter = false,
  setCursorData,
  fullHeight,
  onCtrlEnter,
  onFormatShortcut,
  wrapperClassName,
  completions,
  resizable = false,
  defaultHeight = TEN_LINES_HEIGHT, // for resizable
  showCopyButton = false,
  showFullscreenButton = false,
  onRequestFullscreen,
  onEditorLoad,
  matchValueDisplay = false,
  highlightLines,
  actions,
  containerClassName,
  ...otherProps
}: Props) {
  const fieldProps = otherProps as CodeTextAreaFieldProps;
  const { theme } = useAppearanceUITheme();
  const [editor, setEditor] = useState<null | Ace.Editor>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const editorUid = useId();
  const editorScope = `[data-editor-uid="${editorUid}"]`;
  const codeTheme = getCodeTheme(theme);

  const { performCopy, copySuccess } = useCopyToClipboard({
    timeout: 800,
  });

  // Throttle cursor updates to avoid excessive re-renders
  const cursorUpdateTimeoutRef = useRef<NodeJS.Timeout>();

  const heightProps =
    fullHeight || resizable ? { height: "100%" } : { minLines, maxLines };

  // Handle Ctrl+Enter binding
  useEffect(() => {
    if (!editor) return;
    if (!onCtrlEnter) return;

    editor.commands.bindKey(
      {
        win: "Ctrl-enter",
        mac: "Command-enter",
      },
      {
        exec: onCtrlEnter,
        name: "ctrl-enter",
      },
    );
  }, [editor, onCtrlEnter]);

  useEffect(() => {
    if (!editor || !onFormatShortcut) return;

    editor.commands.addCommand({
      name: "format-shortcut",
      bindKey: { win: "Ctrl-Shift-F", mac: "Command-Shift-F" },
      exec: onFormatShortcut,
    });
    return () => editor.commands.removeCommand("format-shortcut");
  }, [editor, onFormatShortcut]);

  useEffect(() => {
    editor?.renderer.setScrollMargin(paddingTop, 0, 0, 0);
  }, [editor, paddingTop]);

  useEffect(() => {
    if (!editor || !highlightLines?.length) return;
    const ace = (window as unknown as { ace: AceModule }).ace;
    const { Range } = ace.require("ace/range") as { Range: AceRange };
    const session = editor.session;
    const markers = highlightLines.map((line) =>
      session.addMarker(
        new Range(line - 1, 0, line - 1, 1),
        styles.highlightedLine,
        "fullLine",
      ),
    );
    return () => markers.forEach((id) => session.removeMarker(id));
  }, [editor, highlightLines]);

  // Auto-resize editor when container size changes
  useEffect(() => {
    if (!editor || !containerRef.current) return;
    if (!fullHeight && !resizable && !isFullscreen) return;

    // Debounce resize calls to avoid excessive editor.resize() calls
    let resizeTimeout: NodeJS.Timeout;
    const resizeObserver = new ResizeObserver(() => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => editor.resize(), 100);
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      clearTimeout(resizeTimeout);
      resizeObserver.disconnect();
    };
  }, [editor, fullHeight, resizable, isFullscreen]);

  // Resize and focus editor when entering/exiting fullscreen
  useEffect(() => {
    if (!editor) return;
    // Small delay to allow CSS transition to complete
    const timer = setTimeout(() => {
      editor.resize();
      if (isFullscreen) {
        editor.focus();
      }
    }, 50);
    return () => clearTimeout(timer);
  }, [editor, isFullscreen]);

  // Escape key to exit fullscreen
  useEffect(() => {
    if (!isFullscreen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setIsFullscreen(false);
      }
    };
    document.addEventListener("keydown", handleEscape, true);
    return () => document.removeEventListener("keydown", handleEscape, true);
  }, [isFullscreen]);

  // Cleanup cursor timeout on unmount
  useEffect(() => {
    return () => {
      if (cursorUpdateTimeoutRef.current) {
        clearTimeout(cursorUpdateTimeoutRef.current);
      }
    };
  }, []);

  return (
    <Field
      size="legacy"
      {...fieldProps}
      containerClassName={clsx(fullHeight ? "h-100" : "", containerClassName)}
      render={(id) => {
        return (
          <>
            <style>{`
              .code-editor-fullscreen {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                z-index: 1050;
                background-color: var(--color-surface-solid);
                padding: 1rem;
                display: flex;
                flex-direction: column;
              }
              .code-editor-fullscreen .editor-container {
                flex: 1;
                overflow: hidden;
              }
              ${getAceCodeCss(editorScope, codeTheme, language)}
            `}</style>
            <div
              id={editorUid}
              data-editor-uid={editorUid}
              className={clsx({
                [styles.valueEditor]: matchValueDisplay,
                "ace-editor-disabled": fieldProps.disabled,
                "h-100": fullHeight && !isFullscreen,
                "code-editor-fullscreen": isFullscreen,
              })}
            >
              {isFullscreen ? (
                <Flex align="center" gap="3" mb="2" justify="between">
                  <label className="mb-0 d-block font-weight-bold">
                    {fieldProps.label}
                  </label>
                  <Button
                    type="button"
                    size="sm"
                    color="gray"
                    variant="ghost"
                    onClick={() => setIsFullscreen(false)}
                  >
                    Exit full screen (ESC)
                  </Button>
                </Flex>
              ) : null}
              <div
                ref={containerRef}
                className={clsx(
                  "position-relative border rounded",
                  wrapperClassName,
                  {
                    "h-100": fullHeight,
                    "editor-container": isFullscreen,
                  },
                )}
                style={{
                  ...(resizable && !isFullscreen
                    ? {
                        resize: "vertical",
                        overflow: "auto",
                        height: !fullHeight ? defaultHeight : undefined,
                      }
                    : {}),
                }}
              >
                {fieldProps.disabled && (
                  <style>{`
                    .ace-editor-disabled .ace_content {
                      background-color: ${
                        theme === "light"
                          ? "rgba(180, 180, 180, 0.20)"
                          : "rgba(110, 110, 110, 0.25)"
                      };
                    }
                    .ace-editor-disabled .ace_gutter {
                      background-color: ${
                        theme === "light"
                          ? "rgba(180, 180, 180, 0.10)"
                          : "rgba(110, 110, 110, 0.15)"
                      } !important;
                    }
                  `}</style>
                )}
                <AceEditor
                  name={id}
                  onLoad={(e) => {
                    setEditor(e);
                    onEditorLoad?.(e);
                    // Clear auto-selection after editor loads
                    setTimeout(() => {
                      e.clearSelection();
                    }, 100);
                  }}
                  mode={language}
                  theme={theme === "light" ? LIGHT_THEME : DARK_THEME}
                  width="inherit"
                  value={value}
                  onChange={(newValue) => setValue(newValue)}
                  placeholder={placeholder}
                  fontSize={CODE_FONT_SIZE}
                  completions={completions}
                  {...heightProps}
                  setOptions={{
                    wrap: !hasLongLine(value),
                    ...(matchValueDisplay ? { showPrintMargin: false } : {}),
                    ...(slimGutter ? { showFoldWidgets: false } : {}),
                    ...(language === "sql"
                      ? {
                          enableBasicAutocompletion: true,
                          enableLiveAutocompletion: true,
                        }
                      : {}),
                  }}
                  readOnly={fieldProps.disabled}
                  onCursorChange={(e) => {
                    if (!setCursorData) return;
                    // Throttle cursor updates to reduce performance impact on large files
                    clearTimeout(cursorUpdateTimeoutRef.current);
                    cursorUpdateTimeoutRef.current = setTimeout(() => {
                      setCursorData({
                        row: e.cursor.row,
                        column: e.cursor.column,
                        input: e.cursor.document.$lines,
                      });
                    }, 150);
                  }}
                />
                {(actions || showCopyButton || showFullscreenButton) && (
                  <Flex
                    align="center"
                    gap="3"
                    style={{
                      position: "absolute",
                      bottom: 0,
                      // A value display's buttons sit 16px in.
                      right: matchValueDisplay ? 16 : 14,
                    }}
                  >
                    {actions}
                    {showCopyButton && (
                      <EditorAction
                        label={copySuccess ? "Copied" : "Copy to clipboard"}
                        icon={<CopyIcon copied={copySuccess} size="sm" />}
                        onClick={() => {
                          if (!copySuccess) performCopy(value);
                        }}
                      />
                    )}
                    {showFullscreenButton && (
                      <EditorAction
                        key={isFullscreen ? "exit" : "enter"}
                        label={
                          isFullscreen
                            ? "Exit full screen (ESC)"
                            : "Edit in full screen"
                        }
                        icon={<FullscreenIcon exit={isFullscreen} size="sm" />}
                        onClick={() => {
                          if (onRequestFullscreen) {
                            onRequestFullscreen();
                          } else {
                            setIsFullscreen(!isFullscreen);
                          }
                        }}
                      />
                    )}
                  </Flex>
                )}
              </div>
            </div>
          </>
        );
      }}
    />
  );
}

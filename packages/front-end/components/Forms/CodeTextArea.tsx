import dynamic from "next/dynamic";
import { useEffect, useState, useRef, createElement, useId } from "react";
import type { Ace } from "ace-builds";
import type { IAceEditorProps } from "react-ace";
import clsx from "clsx";
import { Flex, IconButton } from "@radix-ui/themes";
import { PiCornersOut, PiCornersIn, PiCopy, PiCheck } from "react-icons/pi";
import Button from "@/ui/Button";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";
import { CursorData } from "@/components/Segments/SegmentForm";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import Field, { FieldProps } from "./Field";

export type AceCompletion = {
  caption: string;
  value: string;
  meta: string;
  score: number;
};

interface AceEditorProps extends IAceEditorProps {
  completions?: AceCompletion[];
}

const AceEditor = dynamic(
  async () => {
    const [ace, reactAce, jsonWorkerUrl, jsWorkerUrl, yamlWorkerUrl] =
      await Promise.all([
        import(
          /* webpackChunkName: "ace-editor" */
          "ace-builds/src-min-noconflict/ace"
        ),
        import(
          /* webpackChunkName: "ace-editor" */
          "react-ace"
        ),
        import(
          /* webpackChunkName: "ace-editor" */
          "ace-builds/src-min-noconflict/worker-json"
        ),
        import(
          /* webpackChunkName: "ace-editor" */
          "ace-builds/src-min-noconflict/worker-javascript"
        ),
        import(
          /* webpackChunkName: "ace-editor" */
          "ace-builds/src-min-noconflict/worker-yaml"
        ),
        import(
          /* webpackChunkName: "ace-editor" */
          "ace-builds/src-min-noconflict/ext-language_tools"
        ),
        import(
          /* webpackChunkName: "ace-editor" */
          "ace-builds/src-min-noconflict/ext-searchbox"
        ),
        import(
          /* webpackChunkName: "ace-editor" */
          "ace-builds/src-min-noconflict/mode-sql"
        ),
        import(
          /* webpackChunkName: "ace-editor" */
          "ace-builds/src-min-noconflict/mode-javascript"
        ),
        import(
          /* webpackChunkName: "ace-editor" */
          "ace-builds/src-min-noconflict/mode-python"
        ),
        import(
          /* webpackChunkName: "ace-editor" */
          "ace-builds/src-min-noconflict/mode-yaml"
        ),
        import(
          /* webpackChunkName: "ace-editor" */
          "ace-builds/src-min-noconflict/mode-json"
        ),
        import(
          /* webpackChunkName: "ace-editor" */
          "ace-builds/src-min-noconflict/theme-textmate"
        ),
        import(
          /* webpackChunkName: "ace-editor" */
          "ace-builds/src-min-noconflict/theme-tomorrow_night"
        ),
      ]);

    ace.config.setModuleUrl("ace/mode/json_worker", jsonWorkerUrl.default);
    ace.config.setModuleUrl("ace/mode/javascript_worker", jsWorkerUrl.default);
    ace.config.setModuleUrl("ace/mode/yaml_worker", yamlWorkerUrl.default);

    const langTools = ace.require("ace/ext/language_tools");

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

      return createElement(reactAce.default, {
        ...otherProps,
        onLoad: handleLoad,
      });
    };

    AceEditorWithCompletions.displayName = "AceEditorWithCompletions";

    return AceEditorWithCompletions;
  },
  {
    ssr: false,
  },
);

export type Language = "sql" | "json" | "javascript" | "python" | "yml";

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
  | "containerClassName"
  | "ref"
>;

export type Props = CodeTextAreaFieldProps & {
  language: Language;
  value: string;
  setValue: (value: string) => void;
  setCursorData?: (data: CursorData) => void;
  minLines?: number;
  maxLines?: number;
  fullHeight?: boolean;
  onCtrlEnter?: () => void;
  wrapperClassName?: string;
  completions?: AceCompletion[];
  resizable?: boolean;
  defaultHeight?: number;
  showCopyButton?: boolean;
  showFullscreenButton?: boolean;
};

const LIGHT_THEME = "textmate";
const DARK_THEME = "tomorrow_night";

export default function CodeTextArea({
  language,
  value,
  setValue,
  placeholder,
  minLines = 10,
  maxLines = 50,
  setCursorData,
  fullHeight,
  onCtrlEnter,
  wrapperClassName,
  completions,
  resizable = false,
  defaultHeight = TEN_LINES_HEIGHT, // for resizable
  showCopyButton = false,
  showFullscreenButton = false,
  ...otherProps
}: Props) {
  const fieldProps = otherProps as CodeTextAreaFieldProps;
  const { theme } = useAppearanceUITheme();
  const [editor, setEditor] = useState<null | Ace.Editor>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const editorUid = useId();

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
      {...fieldProps}
      containerClassName={fullHeight ? "h-100" : ""}
      render={(id) => {
        return (
          <>
            <style>{`
              #${editorUid}.code-editor-fullscreen {
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
              #${editorUid}.code-editor-fullscreen .editor-container {
                flex: 1;
                overflow: hidden;
              }
            `}</style>
            <div
              id={editorUid}
              className={clsx({
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
                    size="xs"
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
                    #${editorUid}.ace-editor-disabled .ace_content {
                      background-color: ${
                        theme === "light"
                          ? "rgba(180, 180, 180, 0.20)"
                          : "rgba(110, 110, 110, 0.25)"
                      };
                    }
                    #${editorUid}.ace-editor-disabled .ace_gutter {
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
                  fontSize="1em"
                  completions={completions}
                  {...heightProps}
                  setOptions={
                    language === "sql"
                      ? {
                          enableBasicAutocompletion: true,
                          enableLiveAutocompletion: true,
                        }
                      : undefined
                  }
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
                {(showCopyButton || showFullscreenButton) && (
                  <Flex
                    align="center"
                    gap="3"
                    style={{
                      position: "absolute",
                      bottom: 0,
                      right: 14,
                    }}
                  >
                    {showCopyButton && (
                      <Tooltip
                        body={copySuccess ? "Copied" : "Copy to clipboard"}
                      >
                        <IconButton
                          type="button"
                          radius="full"
                          variant="ghost"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (!copySuccess) performCopy(value);
                          }}
                          style={{ position: "relative", zIndex: 1000 }}
                        >
                          {copySuccess ? (
                            <PiCheck size={isFullscreen ? 16 : 12} />
                          ) : (
                            <PiCopy size={isFullscreen ? 14 : 12} />
                          )}
                        </IconButton>
                      </Tooltip>
                    )}
                    {showFullscreenButton && (
                      <Tooltip
                        key={isFullscreen ? "exit" : "enter"}
                        body={
                          isFullscreen
                            ? "Exit full screen (ESC)"
                            : "Edit in full screen"
                        }
                      >
                        <IconButton
                          type="button"
                          radius="full"
                          variant="ghost"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setIsFullscreen(!isFullscreen);
                          }}
                          style={{ position: "relative", zIndex: 1000 }}
                        >
                          {isFullscreen ? (
                            <PiCornersIn size={isFullscreen ? 16 : 12} />
                          ) : (
                            <PiCornersOut size={isFullscreen ? 16 : 12} />
                          )}
                        </IconButton>
                      </Tooltip>
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

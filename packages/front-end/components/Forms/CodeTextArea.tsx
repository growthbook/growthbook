import dynamic from "next/dynamic";
import { useEffect, useState, useRef, createElement } from "react";
import type { Ace } from "ace-builds";
import type { IAceEditorProps } from "react-ace";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";
import { CursorData } from "@/components/Segments/SegmentForm";
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
    const [
      ace,
      reactAce,
      jsonWorkerUrl,
      jsWorkerUrl,
      yamlWorkerUrl,
    ] = await Promise.all([
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
                callback: (err: unknown, results: AceCompletion[]) => void
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
                  }
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
  }
);

export type Language = "sql" | "json" | "javascript" | "python" | "yml";

export type Props = Omit<
  FieldProps,
  "value" | "onChange" | "options" | "multi" | "initialOption"
> & {
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
  ...otherProps
}: Props) {
  // eslint-disable-next-line
  const fieldProps = otherProps as any;
  const { theme } = useAppearanceUITheme();
  const [editor, setEditor] = useState<null | Ace.Editor>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const heightProps = fullHeight ? { height: "100%" } : { minLines, maxLines };

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
      }
    );
  }, [editor, onCtrlEnter]);

  // Auto-resize editor when container size changes
  useEffect(() => {
    if (!editor || !containerRef.current || !fullHeight) return;

    const resizeObserver = new ResizeObserver(() => {
      editor.resize();
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, [editor, fullHeight]);

  return (
    <Field
      {...fieldProps}
      containerClassName={fullHeight ? "h-100" : ""}
      render={(id) => {
        return (
          <>
            <div
              ref={containerRef}
              className={`border rounded ${wrapperClassName} ${
                fullHeight ? "h-100" : ""
              }`}
            >
              <AceEditor
                name={id}
                onLoad={(e) => setEditor(e)}
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
                onCursorChange={(e) =>
                  setCursorData &&
                  setCursorData({
                    row: e.cursor.row,
                    column: e.cursor.column,
                    input: e.cursor.document.$lines,
                  })
                }
              />
            </div>
          </>
        );
      }}
    />
  );
}

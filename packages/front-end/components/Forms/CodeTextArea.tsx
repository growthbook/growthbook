import dynamic from "next/dynamic";
import { useEffect, useState, useRef } from "react";
import type { Ace } from "ace-builds";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";
import { CursorData } from "@/components/Segments/SegmentForm";
import Field, { FieldProps } from "./Field";

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

    return reactAce;
  },
  {
    ssr: false, // react-ace doesn't support server side rendering as it uses the window object.
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
                {...heightProps}
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

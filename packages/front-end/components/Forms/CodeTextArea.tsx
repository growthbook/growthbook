import dynamic from "next/dynamic";
import { useEffect, useState, useRef } from "react";
import { Ace } from "ace-builds";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";
import { CursorData } from "@/components/Segments/SegmentForm";
import Field, { FieldProps } from "./Field";

const AceEditor = dynamic(
  async () => {
    const reactAce = await import("react-ace");
    await import("ace-builds/src-min-noconflict/ext-language_tools");
    await import("ace-builds/src-noconflict/mode-sql");
    await import("ace-builds/src-noconflict/mode-javascript");
    await import("ace-builds/src-noconflict/mode-python");
    await import("ace-builds/src-noconflict/mode-yaml");
    await import("ace-builds/src-noconflict/mode-json");
    await import("ace-builds/src-noconflict/theme-textmate");
    await import("ace-builds/src-noconflict/theme-tomorrow_night");
    await import("ace-builds/src-noconflict/ext-searchbox");

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

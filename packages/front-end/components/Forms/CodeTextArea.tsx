import React from "react";
import dynamic from "next/dynamic";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";
import { CursorData } from "../Segments/SegmentForm";
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
  ...otherProps
}: Props) {
  // eslint-disable-next-line
  const fieldProps = otherProps as any;

  const { theme } = useAppearanceUITheme();

  const heightProps = fullHeight ? { height: "100%" } : { minLines, maxLines };

  return (
    <Field
      {...fieldProps}
      containerClassName={fullHeight ? "h-100" : ""}
      render={(id) => {
        return (
          <>
            <div className={`border rounded ${fullHeight ? "h-100" : ""}`}>
              <AceEditor
                name={id}
                mode={language}
                theme={theme === "light" ? LIGHT_THEME : DARK_THEME}
                width="inherit"
                value={value}
                onChange={(newValue) => setValue(newValue)}
                placeholder={placeholder}
                fontSize="1em"
                commands={
                  onCtrlEnter
                    ? [
                        {
                          bindKey: {
                            win: "Ctrl-enter",
                            mac: "Command-enter",
                          },
                          exec: onCtrlEnter,
                          name: "Run Test Query",
                        },
                      ]
                    : []
                }
                {...heightProps}
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

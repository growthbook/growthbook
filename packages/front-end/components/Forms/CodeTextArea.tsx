import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { Ace } from "ace-builds";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";
import { CursorData } from "@/components/Segments/SegmentForm";
import Field, { FieldProps } from "./Field";

export type AceCompletion = {
  caption: string;
  value: string;
  meta: string;
  score: number;
};

const AceEditor = dynamic(
  async () => {
    const reactAce = await import("react-ace");
    await import("ace-builds/src-noconflict/ext-language_tools");
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
  completions?: AceCompletion[];
  resizeDependency?: boolean;
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
  resizeDependency,
  completions,
  ...otherProps
}: Props) {
  // eslint-disable-next-line
  const fieldProps = otherProps as any;
  const { theme } = useAppearanceUITheme();
  const [editor, setEditor] = useState<null | Ace.Editor>(null);

  // HACK: AceEditor doesn't automatically resize when the parent div resizes
  // Also because we dynamically load the AceEditor component, we can't use
  // useRef to get a reference to the editor object, which would allow us to
  // call the resize() method on the editor object. So instead we change the
  // height ever so slightly whenever the resizeDependency variable changes.
  const heightProps = fullHeight
    ? resizeDependency
      ? { height: "99.999%" }
      : { height: "100%" }
    : { minLines, maxLines };

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

  useEffect(() => {
    if (typeof window !== "undefined" && editor) {
      import("ace-builds").then((ace) => {
        const langTools = ace.require("ace/ext/language_tools");

        if (completions && Array.isArray(completions)) {
          // Clear existing completers
          langTools.setCompleters([]);

          // Add our custom completer for templates
          const customCompleter = {
            getCompletions: (
              editor: Ace.Editor,
              session: Ace.EditSession,
              pos: Ace.Position,
              prefix: string,
              callback: (err: unknown, results: AceCompletion[]) => void
            ) => {
              // Filter completions based on the current prefix
              const filteredCompletions = completions.filter((completion) => {
                if (!prefix || prefix.trim() === "") {
                  return true;
                }

                const lowerPrefix = prefix.toLowerCase();
                const lowerValue = completion.value.toLowerCase();
                const lowerCaption = completion.caption.toLowerCase();

                // Helper function to check if any part (split by dots) starts with prefix e.g. database.schema.table
                const checkParts = (text: string) => {
                  if (text.includes(".")) {
                    return text
                      .split(".")
                      .some((part) => part.startsWith(lowerPrefix));
                  }
                  return text.startsWith(lowerPrefix);
                };

                return checkParts(lowerValue) || checkParts(lowerCaption);
              });

              callback(null, filteredCompletions);
            },
            // Add identifier regex that includes { to trigger on curly braces
            identifierRegexps: [/[a-zA-Z_0-9{]/],
          };

          langTools.addCompleter(customCompleter);
        }
      });
    }
  }, [completions, editor, language]);

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
                onLoad={(e) => setEditor(e)}
                mode={language}
                theme={theme === "light" ? LIGHT_THEME : DARK_THEME}
                width="inherit"
                value={value}
                onChange={(newValue) => setValue(newValue)}
                placeholder={placeholder}
                fontSize="1em"
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

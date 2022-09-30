import React, { useMemo } from "react";
import Field, { FieldProps } from "./Field";
import dynamic from "next/dynamic";
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
  height?: number;
  setValue: (value: string) => void;
};

const LIGHT_THEME = "textmate";
const DARK_THEME = "tomorrow_night";

export default function CodeTextArea({
  language,
  value,
  setValue,
  placeholder,
  height = 260,
  ...otherProps
}: Props) {
  // eslint-disable-next-line
  const fieldProps = otherProps as any;

  const semicolonWarning =
    "Warning: Please remove any terminating semicolons. GrowthBook uses Common Table Expressions that will break from terminating semicolons.";

  if (language === "sql" && value.includes(";")) {
    otherProps.error = semicolonWarning;
  }

  const theme = useMemo(() => {
    let actualTheme = LIGHT_THEME;

    try {
      const fromStorage = localStorage.getItem("gb_ui_theme");
      if (
        !fromStorage &&
        window.matchMedia("(prefers-color-scheme: dark)")?.matches
      ) {
        actualTheme = DARK_THEME;
      }

      if (fromStorage === "dark") {
        actualTheme = DARK_THEME;
      }
    } catch (e) {
      return actualTheme;
    }

    return actualTheme;
  }, []);

  return (
    <Field
      {...fieldProps}
      render={(id) => {
        return (
          <>
            <div className="border rounded">
              <AceEditor
                name={id}
                mode={language}
                theme={theme}
                width="inherit"
                height={`${height}px`}
                value={value}
                onChange={(newValue) => setValue(newValue)}
                placeholder={placeholder}
              />
            </div>
          </>
        );
      }}
    />
  );
}

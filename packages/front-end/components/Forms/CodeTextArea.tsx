import React from "react";
import dynamic from "next/dynamic";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";
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
  minLines?: number;
  maxLines?: number;
};

const LIGHT_THEME = "textmate";
const DARK_THEME = "tomorrow_night";

export default function CodeTextArea({
  language,
  value,
  setValue,
  placeholder,
  minLines = 4,
  maxLines = 50,
  ...otherProps
}: Props) {
  // eslint-disable-next-line
  const fieldProps = otherProps as any;

  const semicolonWarning =
    "Warning: Please remove any terminating semicolons. GrowthBook uses Common Table Expressions that will break from terminating semicolons.";

  if (language === "sql" && value.includes(";")) {
    otherProps.error = semicolonWarning;
  }

  const { theme } = useAppearanceUITheme();

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
                theme={theme === "light" ? LIGHT_THEME : DARK_THEME}
                width="inherit"
                value={value}
                onChange={(newValue) => setValue(newValue)}
                placeholder={placeholder}
                minLines={minLines}
                maxLines={maxLines}
              />
            </div>
          </>
        );
      }}
    />
  );
}

import React from "react";
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
};

export default function CodeTextArea({
  language,
  value,
  setValue,
  ...otherProps
}: Props) {
  // eslint-disable-next-line
  const fieldProps = otherProps as any;

  return (
    <Field
      {...fieldProps}
      render={(id) => {
        return (
          <div className="border rounded">
            <AceEditor
              name={id}
              mode={language}
              theme="textmate"
              width="inherit"
              height="140px"
              value={value}
              onChange={(newValue) => setValue(newValue)}
              placeholder={fieldProps.placeholder}
            />
          </div>
        );
      }}
    />
  );
}

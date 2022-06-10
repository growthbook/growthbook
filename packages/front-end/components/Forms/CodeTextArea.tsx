import React from "react";
import Field, { FieldProps } from "./Field";
import AceEditor from "react-ace";
import "ace-builds/src-noconflict/mode-sql";
import "ace-builds/src-noconflict/mode-javascript";
import "ace-builds/src-noconflict/mode-python";
import "ace-builds/src-noconflict/mode-yaml";
import "ace-builds/src-noconflict/mode-json";
import "ace-builds/src-noconflict/theme-textmate";

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
      render={(id, ref) => {
        return (
          <div className="border rounded">
            <AceEditor
              name={id}
              ref={ref}
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

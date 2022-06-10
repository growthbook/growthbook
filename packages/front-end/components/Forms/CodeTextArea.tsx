import React, { ReactNode } from "react";
import Field, { FieldProps } from "./Field";
import AceEditor from "react-ace";
import "ace-builds/src-noconflict/mode-sql";
import "ace-builds/src-noconflict/mode-javascript";
import "ace-builds/src-noconflict/mode-python";
import "ace-builds/src-noconflict/mode-yaml";
import "ace-builds/src-noconflict/mode-json";
import "ace-builds/src-noconflict/theme-textmate";

export type Props = Omit<
  FieldProps,
  "value" | "onChange" | "options" | "multi" | "initialOption"
> & {
  syntax: string;
  placeholder?: string;
  currentValue: string;
  setValue: (value: string) => void;
  codeTextAreaHeight?: string;
  helpText?: ReactNode;
};

function CodeTextArea({
  syntax,
  placeholder,
  currentValue,
  setValue,
  codeTextAreaHeight,
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
              mode={syntax}
              theme="textmate"
              width="inherit"
              height={codeTextAreaHeight || "140px"}
              placeholder={placeholder}
              value={currentValue}
              onChange={(newValue) => setValue(newValue)}
            />
          </div>
        );
      }}
    />
  );
}

export default CodeTextArea;

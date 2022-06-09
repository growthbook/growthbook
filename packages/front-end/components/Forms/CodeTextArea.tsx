import React from "react";
import AceEditor from "react-ace";
import "ace-builds/src-noconflict/mode-sql";
import "ace-builds/src-noconflict/mode-javascript";
import "ace-builds/src-noconflict/mode-python";
import "ace-builds/src-noconflict/mode-yaml";
import "ace-builds/src-noconflict/mode-json";
import "ace-builds/src-noconflict/theme-textmate";

interface SqlTextAreaProps {
  syntax: string;
  placeholder: string;
  currentValue: string;
  setValue: (value: string) => void;
  codeTextAreaHeight?: string;
}

function CodeTextArea({
  syntax,
  placeholder,
  currentValue,
  setValue,
  codeTextAreaHeight,
}: SqlTextAreaProps) {
  return (
    <div className="border rounded">
      <AceEditor
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
}

export default CodeTextArea;

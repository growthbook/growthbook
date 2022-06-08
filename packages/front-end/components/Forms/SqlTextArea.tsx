import React from "react";
import AceEditor from "react-ace";

import "ace-builds/src-noconflict/mode-sql";
import "ace-builds/src-noconflict/theme-sqlserver";

interface SqlTextAreaProps {
  placeholder: string;
  currentValue: string;
  setValue: (value: string) => void;
}

function SqlTextArea({
  placeholder,
  currentValue,
  setValue,
}: SqlTextAreaProps) {
  return (
    <div className="border rounded">
      <AceEditor
        mode="sql"
        theme="sqlserver"
        name="sql"
        width="inherit"
        height="150px"
        placeholder={placeholder}
        value={currentValue}
        onChange={(newValue) => setValue(newValue)}
      />
    </div>
  );
}

export default SqlTextArea;

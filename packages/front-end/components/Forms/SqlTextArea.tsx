import React from "react";
import AceEditor from "react-ace";

import "ace-builds/src-noconflict/mode-sql";
import "ace-builds/src-noconflict/theme-sqlserver";
import "ace-builds/src-noconflict/ext-language_tools";

interface SqlTextAreaProps {
  placeholder: string;
  existingValue: string;
  setValue: (value: string) => void;
}

function SqlTextArea({
  placeholder,
  existingValue,
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
        value={existingValue}
        onChange={(newValue) => setValue(newValue)}
      />
    </div>
  );
}

export default SqlTextArea;

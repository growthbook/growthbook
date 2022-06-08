import React from "react";
import AceEditor from "react-ace";

import "ace-builds/src-noconflict/mode-sql";
import "ace-builds/src-noconflict/theme-sqlserver";
import "ace-builds/src-noconflict/ext-language_tools";

interface SqlTextAreaProps {
  placeholder: string;
  value: string;
  setValue: (value: string) => void;
}

function SqlTextArea({ placeholder, value, setValue }: SqlTextAreaProps) {
  return (
    <div className="border rounded">
      <AceEditor
        mode="sql"
        theme="sqlserver"
        name="sql"
        width="inherit"
        height="100px"
        // font-size="0.875rem"
        placeholder={placeholder}
        value={value}
        onChange={(value) => setValue(value)}
      />
    </div>
  );
}

export default SqlTextArea;

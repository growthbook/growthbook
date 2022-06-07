import React from "react";
import AceEditor from "react-ace";

import "ace-builds/src-noconflict/mode-sql";
import "ace-builds/src-noconflict/theme-sqlserver";
import "ace-builds/src-noconflict/ext-language_tools";

interface SqlTextAreaProps extends React.HTMLProps<HTMLTextAreaElement> {
  placeholder: string;
}

function SqlTextArea({ placeholder, ref, ...otherProps }: SqlTextAreaProps) {
  console.log(otherProps.name);
  console.log(otherProps.onChange);
  console.log(ref);

  function handleChange(newValue) {
    console.log(newValue);
    otherProps.onChange(newValue);
  }

  return (
    <div className="border rounded">
      <AceEditor
        // ref={ref}
        mode="sql"
        theme="sqlserver"
        name="sql"
        width="inherit"
        height="100px"
        font-size="0.875rem"
        placeholder={placeholder}
        onChange={handleChange}
      />
      <input name="sql" onChange={(e) => handleChange(e)} />
    </div>
  );
}

export default SqlTextArea;

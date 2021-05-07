import { FC } from "react";
import Editor from "react-simple-code-editor";
import { highlight, languages } from "prismjs";
import styles from "./SqlEditor.module.scss";
import "prismjs/components/prism-sql";

export type Props = {
  code: string;
  setCode: (code: string) => void;
};

const SqlEditor: FC<Props> = ({ code, setCode }) => {
  return (
    <div className={styles.editor}>
      <Editor
        value={code}
        onValueChange={(code) => setCode(code)}
        highlight={(code) => highlight(code, languages.sql, "js")}
        padding={10}
        style={{
          fontFamily: '"Fira code", "Fira Mono", monospace',
          background: "rgb(39, 40, 34)",
          minHeight: 300,
        }}
      />
    </div>
  );
};

export default SqlEditor;

import { Prism } from "react-syntax-highlighter";
import { tomorrow as theme } from "react-syntax-highlighter/dist/cjs/styles/prism";

export type Language =
  | "none"
  | "sql"
  | "ruby"
  | "json"
  | "javascript"
  | "tsx"
  | "html"
  | "css"
  | "php"
  | "python"
  | "go"
  | "java";

export default function Code({
  code,
  language,
}: {
  code: string;
  language: Language;
}) {
  return (
    <Prism language={language} style={theme}>
      {code}
    </Prism>
  );
}

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
  | "yml"
  | "java";

export default function Code({
  code,
  language,
  padding,
}: {
  code: string;
  language: Language;
  padding?: string;
}) {
  return (
    <Prism language={language} style={theme} customStyle={{ padding }}>
      {code}
    </Prism>
  );
}

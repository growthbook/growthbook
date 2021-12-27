import { Prism } from "react-syntax-highlighter";
import {
  tomorrow as dark,
  ghcolors as light,
} from "react-syntax-highlighter/dist/cjs/styles/prism";

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
  theme = "dark",
  className = "",
}: {
  code: string;
  language: Language;
  theme?: "light" | "dark";
  className?: string;
}) {
  return (
    <Prism
      language={language}
      style={theme === "light" ? light : dark}
      className={className}
    >
      {code}
    </Prism>
  );
}

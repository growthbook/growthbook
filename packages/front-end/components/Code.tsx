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
  | "sh"
  | "yml"
  | "kotlin"
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
  light['code[class*="language-"]'].fontSize = "1em";
  light['code[class*="language-"]'].fontWeight = "600";
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

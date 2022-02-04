import { useState } from "react";
import Code, { Language } from "../Code";

export type ExampleLanguage = "javascript" | "react" | "go" | "kotlin";

export type LanguageData = {
  language: ExampleLanguage;
  files: {
    name: string;
    code: string;
    language: Language;
  }[];
};

export interface Props {
  language: [ExampleLanguage, (language: ExampleLanguage) => void];
  code: LanguageData[];
}

export function useExampleLanguage() {
  return useState<ExampleLanguage>("javascript");
}

const displayMap: Record<ExampleLanguage, string> = {
  javascript: "Javascript",
  react: "React",
  kotlin: "Android",
  go: "Go",
};

export default function ExampleCode({
  language: [language, setLanguage],
  code,
}: Props) {
  const current = code.filter((c) => c.language === language)[0];

  return (
    <div>
      <div className="d-flex mb-2">
        {code.map((c) => (
          <div className="py-1 mr-4" key={c.language}>
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setLanguage(c.language);
              }}
              className={
                language === c.language
                  ? "font-weight-bold border-primary"
                  : "text-muted"
              }
              style={{
                borderBottomWidth: language === c.language ? "3px" : "",
                borderBottomStyle:
                  language === c.language ? "solid" : "initial",
              }}
            >
              {displayMap[c.language]}
            </a>
          </div>
        ))}
      </div>
      {current &&
        current.files.map(({ code, name, language }) => (
          <div key={name}>
            <div>
              <small style={{ opacity: 0.8 }}>{name}</small>
            </div>
            <Code
              language={language}
              code={code.trim()}
              className="m-0"
              theme="light"
            />
          </div>
        ))}
    </div>
  );
}

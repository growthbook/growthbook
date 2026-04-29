import clsx from "clsx";
import React, {
  CSSProperties,
  ReactElement,
  Suspense,
  lazy,
  useState,
} from "react";
import { FaCompressAlt, FaExpandAlt } from "react-icons/fa";
import cloneDeep from "lodash/cloneDeep";
import {
  ghcolors as light,
  tomorrow as dark,
} from "react-syntax-highlighter/dist/cjs/styles/prism";
import { HiOutlineClipboard, HiOutlineClipboardCheck } from "react-icons/hi";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import PrismFallback from "./PrismFallback";

// Lazy-load syntax highlighting to improve page load time
const Prism = lazy(() => import("./Prism"));

export type Language =
  | "none"
  | "bash"
  | "sql"
  | "ruby"
  | "json"
  | "javascript"
  | "typescript"
  | "tsx"
  | "html"
  | "css"
  | "php"
  | "python"
  | "swift"
  | "go"
  | "sh"
  | "yml"
  | "kotlin"
  | "xml"
  | "dart"
  | "csharp"
  | "java"
  | "elixir";

const LanguageDisplay: Record<string, string> = {
  sh: "Terminal",
  bash: "Terminal",
  tsx: "JSX",
  none: "Code",
};

export default function Code({
  code,
  language,
  className = "",
  style: _style,
  expandable = false,
  containerClassName,
  filename,
  errorLine,
  highlightLine,
  startingLineNumber,
  showLineNumbers = true,
  maxHeight,
}: {
  code: string;
  language: Language;
  className?: string;
  style?: CSSProperties;
  expandable?: boolean;
  containerClassName?: string;
  filename?: string | ReactElement;
  errorLine?: number;
  highlightLine?: number;
  startingLineNumber?: number;
  showLineNumbers?: boolean;
  maxHeight?: string;
}) {
  language = language || "none";
  if (language === "sh") language = "bash";

  const [expanded, setExpanded] = useState(!expandable);

  const { theme } = useAppearanceUITheme();

  const enoughLines = code.split("\n").length > 8;

  const style = cloneDeep(theme === "dark" ? dark : light);
  style['code[class*="language-"]'].fontSize = "0.85rem";
  style['code[class*="language-"]'].lineHeight = 1.5;
  style['code[class*="language-"]'].fontWeight = 600;

  const codeBackgrounds = {
    dark: "transparent",
    light: "#fff",
  };
  style['pre[class*="language-"]'].backgroundColor = codeBackgrounds[theme];
  style['pre[class*="language-"]'].border = "1px solid var(--slate-a4)";

  if (maxHeight) {
    style['pre[class*="language-"]'].maxHeight = maxHeight;
  }

  const display =
    filename ||
    (language in LanguageDisplay
      ? LanguageDisplay[language]
      : language.toUpperCase());

  const { performCopy, copySuccess, copySupported } = useCopyToClipboard({
    timeout: 1500,
  });

  return (
    <div
      className={clsx(`code-holder d-flex flex-column`, containerClassName, {
        collapsible: expandable && enoughLines,
        collapsed: !expanded,
      })}
      style={{
        maxWidth: "100%",
        ..._style,
      }}
    >
      <div
        className="action-buttons bg-light d-flex align-items-center rounded-top"
        style={{ border: "1px solid var(--slate-a4)", borderBottom: "none" }}
      >
        <div>
          <small className="text-muted px-2">{display}</small>
        </div>
        <div className="ml-auto"></div>
        {copySuccess && (
          <div className="message">
            copied!
            <div className="arrow" />
          </div>
        )}
        {copySupported && (
          <div
            className="p-1 text-muted"
            title="Copy to Clipboard"
            role="button"
            style={{ cursor: "pointer", fontSize: "1.1rem" }}
            onClick={async (e) => {
              e.preventDefault();
              performCopy(code);
            }}
          >
            {copySuccess ? <HiOutlineClipboardCheck /> : <HiOutlineClipboard />}
          </div>
        )}

        {expandable && enoughLines && (
          <div
            className="p-1 text-muted"
            title={expanded ? "Collapse" : "Expand"}
            role="button"
            style={{ cursor: "pointer" }}
            onClick={async (e) => {
              e.preventDefault();
              setExpanded(!expanded);
            }}
          >
            {expanded ? <FaCompressAlt /> : <FaExpandAlt />}
          </div>
        )}
      </div>
      <Suspense
        fallback={
          <PrismFallback
            language={language}
            style={style}
            className={clsx("rounded-bottom", className)}
            code={code}
          />
        }
      >
        <Prism
          language={language}
          style={style}
          className={clsx("rounded-bottom", className)}
          showLineNumbers={showLineNumbers}
          startingLineNumber={startingLineNumber ?? 1}
          {...(errorLine
            ? {
                wrapLines: true,
                lineProps: (
                  lineNumber: number,
                ): React.HTMLProps<HTMLElement> => {
                  const style: React.CSSProperties = {};
                  if (errorLine && lineNumber === errorLine) {
                    style.textDecoration = "underline wavy red";
                    style.textUnderlineOffset = "0.2em";
                  }
                  return { style };
                },
              }
            : {})}
          {...(highlightLine
            ? {
                wrapLines: true,
                lineProps: (
                  lineNumber: number,
                ): React.HTMLProps<HTMLElement> => {
                  const style: React.CSSProperties = {};
                  if (highlightLine && lineNumber === highlightLine) {
                    style.backgroundColor = "rgba(255, 255, 0, 0.2)";
                  }
                  return { style };
                },
              }
            : {})}
        >
          {code}
        </Prism>
      </Suspense>
    </div>
  );
}

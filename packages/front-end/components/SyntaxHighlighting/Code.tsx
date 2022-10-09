import clsx from "clsx";
import { useEffect, useState, Suspense } from "react";
import { FaCompressAlt, FaExpandAlt, FaRegClipboard } from "react-icons/fa";
import cloneDeep from "lodash/cloneDeep";
import dynamic from "next/dynamic";
import {
  tomorrow as dark,
  ghcolors as light,
} from "react-syntax-highlighter/dist/cjs/styles/prism";
import PrismFallback from "./PrismFallback";
import { useAppearanceUITheme } from "../../services/AppearanceUIThemeProvider";

// Lazy-load syntax highlighting to improve page load time
const Prism = dynamic(() => import("./Prism"), {
  suspense: true,
});

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
  | "swift"
  | "go"
  | "sh"
  | "yml"
  | "kotlin"
  | "java";

const LanguageDisplay: Record<string, string> = {
  sh: "Terminal",
  tsx: "JSX",
  none: "Code",
};

export default function Code({
  code,
  language,
  className = "",
  expandable = false,
  containerClassName,
  filename,
}: {
  code: string;
  language: Language;
  className?: string;
  expandable?: boolean;
  containerClassName?: string;
  filename?: string;
}) {
  language = language || "none";

  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(!expandable);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => {
      setCopied(false);
    }, 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  const { theme } = useAppearanceUITheme();

  const enoughLines = code.split("\n").length > 8;

  const style = cloneDeep(theme === "light" ? light : dark);
  style['code[class*="language-"]'].fontSize = "0.85rem";
  style['code[class*="language-"]'].lineHeight = 1.5;
  style['code[class*="language-"]'].fontWeight = 600;
  delete style['pre[class*="language-"]'].background;
  delete style['pre[class*="language-"]'].backgroundColor;
  style['pre[class*="language-"]'].background =
    "var(--surface-background-color-alt)";
  style['pre[class*="language-"]'].border = "1px solid var(--border-color-200)";

  const display =
    filename ||
    (language in LanguageDisplay
      ? LanguageDisplay[language]
      : language.toUpperCase());

  return (
    <div
      className={clsx(`code-holder d-flex flex-column`, containerClassName, {
        collapsible: expandable && enoughLines,
        collapsed: !expanded,
      })}
      style={{
        maxWidth: "100%",
      }}
    >
      <div className="action-buttons bg-light border border-bottom-0 d-flex align-items-center rounded-top">
        <div>
          <small className="text-muted px-2">{display}</small>
        </div>
        <div className="ml-auto"></div>
        {copied && (
          <div className="message">
            copied!
            <div className="arrow" />
          </div>
        )}
        <div
          className="p-1 text-muted"
          title="Copy to Clipboard"
          role="button"
          style={{ cursor: "pointer" }}
          onClick={async (e) => {
            e.preventDefault();
            await navigator.clipboard.writeText(code);
            setCopied(true);
          }}
        >
          <FaRegClipboard />
        </div>

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
          showLineNumbers={true}
        >
          {code}
        </Prism>
      </Suspense>
    </div>
  );
}

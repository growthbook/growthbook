import clsx from "clsx";
import { useEffect, useState, Suspense } from "react";
import { FaCompressAlt, FaCopy, FaExpandAlt } from "react-icons/fa";
import cloneDeep from "lodash/cloneDeep";
import dynamic from "next/dynamic";
import {
  tomorrow as dark,
  ghcolors as light,
} from "react-syntax-highlighter/dist/cjs/styles/prism";
import PrismFallback from "./SyntaxHighlighting/PrismFallback";

// Lazy-load syntax highlighting to improve page load time
const Prism = dynamic(() => import("./SyntaxHighlighting/Prism"), {
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
  expandable = false,
  containerClassName,
  actionBar = true,
  lineNumbers = false,
}: {
  code: string;
  language: Language;
  theme?: "light" | "dark";
  className?: string;
  expandable?: boolean;
  containerClassName?: string;
  actionBar?: boolean;
  lineNumbers?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(!expandable);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => {
      setCopied(false);
    }, 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  const enoughLines = code.split("\n").length > 8;

  const style = cloneDeep(theme === "light" ? light : dark);
  style['code[class*="language-"]'].fontSize = "1em";
  style['code[class*="language-"]'].fontWeight = 600;

  return (
    <div
      className={clsx(`code-holder position-relative`, containerClassName, {
        collapsible: expandable && enoughLines && actionBar,
        collapsed: !expanded,
      })}
    >
      {actionBar && (
        <div className="action-buttons">
          {copied && (
            <div className="message">
              copied!
              <div className="arrow" />
            </div>
          )}
          <button
            className={`btn btn-${copied ? "primary" : "secondary"} btn-sm`}
            type="button"
            title="Copy to Clipboard"
            onClick={async (e) => {
              e.preventDefault();
              await navigator.clipboard.writeText(code);
              setCopied(true);
            }}
          >
            <FaCopy />
          </button>

          {expandable && enoughLines && (
            <button
              className={`btn btn-${
                expanded ? "primary" : "secondary"
              } btn-sm ml-2`}
              type="button"
              title={expanded ? "Collapse" : "Expand"}
              onClick={(e) => {
                e.preventDefault();
                setExpanded(!expanded);
              }}
            >
              {expanded ? <FaCompressAlt /> : <FaExpandAlt />}
            </button>
          )}
        </div>
      )}
      <div className="code">
        <Suspense
          fallback={
            <PrismFallback
              language={language}
              style={style}
              className={className}
              code={code}
            />
          }
        >
          <Prism
            language={language}
            style={style}
            className={className}
            showLineNumbers={lineNumbers}
          >
            {code}
          </Prism>
        </Suspense>
      </div>
    </div>
  );
}

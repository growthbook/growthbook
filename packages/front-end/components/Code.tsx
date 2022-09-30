import clsx from "clsx";
import { useEffect, useState } from "react";
import { FaCompressAlt, FaCopy, FaExpandAlt } from "react-icons/fa";
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

  light['code[class*="language-"]'].fontSize = "1em";
  light['code[class*="language-"]'].fontWeight = 600;

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
        <Prism
          language={language}
          style={theme === "light" ? light : dark}
          className={className}
          showLineNumbers={lineNumbers}
        >
          {code}
        </Prism>
      </div>
    </div>
  );
}

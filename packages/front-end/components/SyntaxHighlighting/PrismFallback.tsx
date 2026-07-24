import clsx from "clsx";
import { CSSProperties, useMemo } from "react";
import type { Language } from "./Code";
import { tokenizeSql } from "./sqlTokenizer";
import styles from "./PrismFallback.module.scss";

export interface Props {
  code: string;
  style: {
    [key: string]: CSSProperties;
  };
  language: Language;
  className?: string;
  showLineNumbers?: boolean;
  startingLineNumber?: number;
  previewOnly?: boolean;
  onPreviewExpand?: () => void;
}

const SQL_PREVIEW_LINES = 16;

interface FallbackContent {
  highlightedText: string | null;
  plainText: string;
  lineNumbers: string | undefined;
  lineNumberWidth: string;
  showExpandButton: boolean;
}

function renderHighlightedSQL(code: string, style: Props["style"]) {
  // The token types we use match the Prism theme keys
  // so we can use it to apply the proper css style
  return tokenizeSql(code).map((segment, i) => {
    if (segment.type === "text") return segment.value;

    return (
      <span style={style[segment.type]} key={i}>
        {segment.value}
      </span>
    );
  });
}

function computeLineNumberWidth(
  totalLines: number,
  startingLineNumber: number,
): string {
  const widestLineNumber = totalLines + startingLineNumber;
  return `${widestLineNumber.toString().length}.25em`;
}

// Preview renders just the first chunk of lines with lightweight SQL
// highlighting and an optional "view full query" button.
function buildPreviewContent({
  code,
  language,
  startingLineNumber,
  showLineNumbers,
  onPreviewExpand,
}: {
  code: string;
  language: Language;
  startingLineNumber: number;
  showLineNumbers: boolean;
  onPreviewExpand?: () => void;
}): FallbackContent {
  const lines = code.split("\n");
  const visibleLines = lines.slice(0, SQL_PREVIEW_LINES);
  const showExpandButton =
    lines.length > visibleLines.length && !!onPreviewExpand;

  const highlightedText = language === "sql" ? visibleLines.join("\n") : null;
  const plainText = language === "sql" ? "" : visibleLines.join("\n");

  let lineNumbers: string | undefined;
  if (showLineNumbers) {
    const numbers = visibleLines.map((_, i) => String(startingLineNumber + i));
    if (showExpandButton) {
      numbers.push(String(startingLineNumber + visibleLines.length));
    }
    lineNumbers = numbers.join("\n");
  }

  return {
    highlightedText,
    plainText,
    lineNumbers,
    lineNumberWidth: computeLineNumberWidth(lines.length, startingLineNumber),
    showExpandButton,
  };
}

// Full content renders the whole code as plain text (no highlighting)
// while Prism loads
function buildFullContent({
  code,
  startingLineNumber,
  showLineNumbers,
}: {
  code: string;
  startingLineNumber: number;
  showLineNumbers: boolean;
}): FallbackContent {
  const lines = code.split("\n");

  let lineNumbers: string | undefined;
  if (showLineNumbers) {
    lineNumbers = lines
      .map((_, i) => String(startingLineNumber + i))
      .join("\n");
  }

  return {
    highlightedText: null,
    plainText: code,
    lineNumbers,
    lineNumberWidth: computeLineNumberWidth(lines.length, startingLineNumber),
    showExpandButton: false,
  };
}

export default function PrismFallback({
  className,
  style,
  language,
  code,
  showLineNumbers = false,
  startingLineNumber = 1,
  previewOnly = false,
  onPreviewExpand,
}: Props) {
  const {
    highlightedText,
    plainText,
    lineNumbers,
    lineNumberWidth,
    showExpandButton,
  } = previewOnly
    ? buildPreviewContent({
        code,
        language,
        startingLineNumber,
        showLineNumbers,
        onPreviewExpand,
      })
    : buildFullContent({ code, startingLineNumber, showLineNumbers });

  const highlightedPreview = useMemo(() => {
    if (!highlightedText) return null;
    return renderHighlightedSQL(highlightedText, style);
  }, [highlightedText, style]);

  const preStyle = useMemo(() => {
    const baseStyle = style['pre[class*="language-"]'];
    if (!showLineNumbers) return baseStyle;

    const codeStyle = style['code[class*="language-"]'];

    return {
      ...baseStyle,
      fontSize: codeStyle?.fontSize,
      lineHeight: codeStyle?.lineHeight,
      "--syntax-highlight-fallback-line-number-color":
        style.comment?.color ?? baseStyle?.color,
      "--syntax-highlight-fallback-line-number-font-style":
        style.comment?.fontStyle,
      "--syntax-highlight-fallback-line-number-font-weight":
        codeStyle?.fontWeight,
      "--syntax-highlight-fallback-line-number-width": lineNumberWidth,
      paddingLeft: `calc(1em + ${lineNumberWidth} + 1em)`,
      position: "relative" as const,
    };
  }, [style, showLineNumbers, lineNumberWidth]);

  // This is a fallback while the full syntax highlighter loads
  // Since we have the exact same styles, it shouldn't cause any layout shifts.
  return (
    <pre
      className={clsx(className, `language-${language}`, styles.fallback, {
        [styles.withLineNumbers]: showLineNumbers,
      })}
      data-line-numbers={lineNumbers}
      style={preStyle}
    >
      <code
        className={`language-${language}`}
        style={style['code[class*="language-"]']}
      >
        {highlightedPreview}
        {highlightedText && plainText ? "\n" : null}
        {plainText}
        {showExpandButton ? (
          <>
            {"\n"}
            <button
              type="button"
              className={styles.previewCta}
              onClick={onPreviewExpand}
            >
              View full query
            </button>
          </>
        ) : null}
      </code>
    </pre>
  );
}

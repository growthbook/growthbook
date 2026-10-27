import clsx from "clsx";
import React, {
  CSSProperties,
  ReactElement,
  Suspense,
  lazy,
  useMemo,
  useState,
} from "react";
import { FaCompressAlt, FaExpandAlt } from "react-icons/fa";
import cloneDeep from "lodash/cloneDeep";
import { HiOutlineClipboard, HiOutlineClipboardCheck } from "react-icons/hi";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { CODE_FONT_SIZE, CODE_LINE_HEIGHT, getCodeTheme } from "./codeTheme";
import PrismFallback from "./PrismFallback";
import styles from "./Code.module.scss";

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
  | "elixir"
  | "protobuf"
  | "rust";

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
  collapsedLines,
  containerClassName,
  filename,
  errorLine,
  highlightLine,
  startingLineNumber,
  showLineNumbers = true,
  maxHeight,
  wrapLongLines = false,
}: {
  code: string;
  language: Language;
  className?: string;
  style?: CSSProperties;
  expandable?: boolean;
  /** Lines to show while collapsed. Defaults to the stylesheet's ~10em. */
  collapsedLines?: number;
  containerClassName?: string;
  filename?: string | ReactElement;
  errorLine?: number;
  highlightLine?: number;
  startingLineNumber?: number;
  showLineNumbers?: boolean;
  maxHeight?: string;
  // Wraps lines that are wider than the container instead of scrolling
  wrapLongLines?: boolean;
}) {
  language = language || "none";
  if (language === "sh") language = "bash";

  const [isExpanded, setIsExpanded] = useState(!expandable);
  const [hasExpanded, setHasExpanded] = useState(!expandable);

  const expand = () => {
    setIsExpanded(true);
    setHasExpanded(true);
  };

  const { theme } = useAppearanceUITheme();

  const enoughLines = code.split("\n").length > (collapsedLines ?? 8);

  // Line numbers are (digits + 0.25)em wide with 1em of right padding
  const lastLineNumber =
    (startingLineNumber ?? 1) + code.split("\n").length - 1;
  const wrapIndentEm = showLineNumbers
    ? String(lastLineNumber).length + 1.25
    : 0;

  const style = useMemo(() => {
    const style = cloneDeep(getCodeTheme(theme));

    const codeBackgrounds = {
      dark: "transparent",
      light: "#fff",
    };
    style['pre[class*="language-"]'].backgroundColor = codeBackgrounds[theme];
    style['pre[class*="language-"]'].border = "1px solid var(--slate-a4)";

    if (maxHeight) {
      style['pre[class*="language-"]'].maxHeight = maxHeight;
    } else if (collapsedLines !== undefined && !isExpanded) {
      // Each line is the code font size times its line height, plus the 1em
      // of padding Prism puts above and below
      style['pre[class*="language-"]'].maxHeight =
        `calc(${collapsedLines} * ${CODE_FONT_SIZE} * ${CODE_LINE_HEIGHT} + 2em)`;
    }

    return style;
  }, [theme, maxHeight, collapsedLines, isExpanded]);

  const shouldRenderPrism =
    hasExpanded ||
    !enoughLines ||
    errorLine !== undefined ||
    highlightLine !== undefined ||
    startingLineNumber !== undefined;

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
      className={clsx(
        "d-flex flex-column",
        styles.codeHolder,
        containerClassName,
        {
          [styles.collapsible]: expandable && enoughLines,
          [styles.collapsed]: !isExpanded,
        },
      )}
      style={{
        maxWidth: "100%",
        ..._style,
      }}
    >
      <div
        className={clsx(
          "bg-light d-flex align-items-center rounded-top",
          styles.actionButtons,
        )}
      >
        <div>
          <small className="text-muted px-2">{display}</small>
        </div>
        <div className="ml-auto"></div>
        {copySuccess && (
          <div className={styles.message}>
            copied!
            <div className={styles.arrow} />
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
            title={isExpanded ? "Collapse" : "Expand"}
            role="button"
            style={{ cursor: "pointer" }}
            onClick={async (e) => {
              e.preventDefault();
              isExpanded ? setIsExpanded(false) : expand();
            }}
          >
            {isExpanded ? <FaCompressAlt /> : <FaExpandAlt />}
          </div>
        )}
      </div>
      {!shouldRenderPrism ? (
        // Keep the fallback rendering until expanded
        // this way it is more lightweight and does not block the UI
        <PrismFallback
          language={language}
          style={style}
          className={clsx("rounded-bottom", className)}
          code={code}
          showLineNumbers={showLineNumbers}
          startingLineNumber={startingLineNumber ?? 1}
          previewOnly
          onPreviewExpand={expand}
        />
      ) : (
        <Suspense
          fallback={
            <PrismFallback
              language={language}
              style={style}
              className={clsx("rounded-bottom", className)}
              code={code}
              showLineNumbers={showLineNumbers}
              startingLineNumber={startingLineNumber ?? 1}
            />
          }
        >
          <Prism
            language={language}
            style={style}
            className={clsx("rounded-bottom", className)}
            showLineNumbers={showLineNumbers}
            startingLineNumber={startingLineNumber ?? 1}
            {...(wrapLongLines
              ? {
                  // The library's own wrapLongLines makes each line a flex
                  // container when line numbers show, which collapses the
                  // spaces between tokens. Wrap each line as a block with a
                  // hanging indent past its line number instead.
                  wrapLines: true,
                  lineProps: (): React.HTMLProps<HTMLElement> => ({
                    style: {
                      display: "block",
                      whiteSpace: "pre-wrap",
                      overflowWrap: "anywhere",
                      paddingLeft: `${wrapIndentEm}em`,
                      textIndent: `-${wrapIndentEm}em`,
                    },
                  }),
                  lineNumberStyle: { textIndent: 0 },
                }
              : {})}
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
      )}
    </div>
  );
}

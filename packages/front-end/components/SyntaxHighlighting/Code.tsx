import clsx from "clsx";
import React, {
  CSSProperties,
  ReactElement,
  Suspense,
  lazy,
  useMemo,
  useState,
} from "react";
import { PiArrowsInSimple, PiArrowsOutSimple } from "react-icons/pi";
import cloneDeep from "lodash/cloneDeep";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { CopyIcon } from "@/ui/ActionIcons";
import Text from "@/ui/Text";
import UITooltip from "@/ui/Tooltip";
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

  const style = useMemo(() => {
    const style = cloneDeep(getCodeTheme(theme));

    const codeBackgrounds = {
      dark: "transparent",
      light: "#fff",
    };
    style['pre[class*="language-"]'].backgroundColor = codeBackgrounds[theme];
    style['pre[class*="language-"]'].border = "1px solid var(--slate-a4)";
    // Square on top, where the header meets it.
    style['pre[class*="language-"]'].borderRadius =
      "0 0 var(--radius-2) var(--radius-2)";

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
    <Flex
      direction="column"
      className={clsx(styles.codeHolder, containerClassName, {
        [styles.collapsible]: expandable && enoughLines,
        [styles.collapsed]: !isExpanded,
      })}
      style={{
        maxWidth: "100%",
        ..._style,
      }}
    >
      <Flex
        align="center"
        gap="3"
        px="2"
        py="1"
        className={styles.actionButtons}
        style={{
          background: "var(--slate-a2)",
          borderRadius: "var(--radius-2) var(--radius-2) 0 0",
        }}
      >
        <Text size="sm" color="text-low">
          {display}
        </Text>
        <Box flexGrow="1" />
        {copySupported && (
          <UITooltip content={copySuccess ? "Copied" : "Copy to clipboard"}>
            <IconButton
              type="button"
              size="1"
              radius="full"
              variant="ghost"
              aria-label="Copy to clipboard"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!copySuccess) performCopy(code);
              }}
            >
              <CopyIcon copied={copySuccess} size="sm" />
            </IconButton>
          </UITooltip>
        )}

        {expandable && enoughLines && (
          <UITooltip content={isExpanded ? "Collapse" : "Expand"}>
            <IconButton
              type="button"
              size="1"
              radius="full"
              variant="ghost"
              aria-label={isExpanded ? "Collapse" : "Expand"}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (isExpanded) setIsExpanded(false);
                else expand();
              }}
            >
              {isExpanded ? <PiArrowsInSimple /> : <PiArrowsOutSimple />}
            </IconButton>
          </UITooltip>
        )}
      </Flex>
      {!shouldRenderPrism ? (
        // Keep the fallback rendering until expanded
        // this way it is more lightweight and does not block the UI
        <PrismFallback
          language={language}
          style={style}
          className={className}
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
              className={className}
              code={code}
              showLineNumbers={showLineNumbers}
              startingLineNumber={startingLineNumber ?? 1}
            />
          }
        >
          <Prism
            language={language}
            style={style}
            className={className}
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
      )}
    </Flex>
  );
}

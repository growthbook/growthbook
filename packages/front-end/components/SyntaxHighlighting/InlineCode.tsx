import { CSSProperties, Suspense, lazy } from "react";
import cloneDeep from "lodash/cloneDeep";
import clsx from "clsx";
import { createElement, createElementProps } from "react-syntax-highlighter";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";
import { Language } from "./Code";
import PrismFallback from "./PrismFallback";
import { CODE_FONT_WEIGHT, CODE_LINE_HEIGHT, getCodeTheme } from "./codeTheme";

// Turn substrings of the highlighted code that match `pattern` (a regex with a
// single capture group) into links. `getHref` receives the captured group; a
// returned URL becomes an `<a>`, `undefined` leaves the text untouched.
export interface LinkifyConfig {
  pattern: RegExp;
  getHref: (captured: string) => string | undefined;
}

// The hast-like nodes react-syntax-highlighter passes to a custom `renderer`
// and feeds back into createElement.
type RNode = createElementProps["node"];

// Split a text node's value on `pattern`, replacing matched references with
// anchor nodes. Unknown references (getHref → undefined) stay as plain text.
function linkifyText(text: string, linkify: LinkifyConfig): RNode[] {
  const re = new RegExp(linkify.pattern.source, "g");
  const out: RNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const href = linkify.getHref(m[1]);
    if (href === undefined) continue; // not a known reference — leave as text
    if (m.index > last)
      out.push({ type: "text", value: text.slice(last, m.index) });
    out.push({
      type: "element",
      tagName: "a",
      properties: {
        href,
        target: "_blank",
        rel: "noreferrer",
        className: ["hover-underline"],
        style: {
          cursor: "pointer",
          color: "var(--gray-11)",
          textUnderlineOffset: "calc(.025em + 2px)",
        },
        // Don't let the link click bubble to a clickable parent (e.g. a rule row).
        onClick: (e: React.MouseEvent) => e.stopPropagation(),
      },
      children: [{ type: "text", value: m[0] }],
    });
    last = m.index + m[0].length;
  }
  if (!out.length) return [{ type: "text", value: text }];
  if (last < text.length) out.push({ type: "text", value: text.slice(last) });
  return out;
}

function linkifyNodes(nodes: RNode[], linkify: LinkifyConfig): RNode[] {
  return nodes.flatMap((node) => {
    if (node.type === "text" && typeof node.value === "string") {
      return linkifyText(node.value, linkify);
    }
    if (node.children) {
      // Prism tags JSON object keys as `property` tokens. A key isn't a
      // resolvable reference position (the resolver only acts on `$extends`
      // array elements and `{{ @const:key }}` interpolations), so skip
      // linkifying inside them — otherwise the legacy `"@const:key": true`
      // notation renders as a live link to a reference that no longer resolves.
      const className = node.properties?.className;
      if (Array.isArray(className) && className.includes("property")) {
        return [node];
      }
      return [{ ...node, children: linkifyNodes(node.children, linkify) }];
    }
    return [node];
  });
}

const HIGHLIGHTED_LINE: CSSProperties = {
  display: "block",
  backgroundColor: "var(--amber-a3)",
};

// Lazy-load syntax highlighting to improve page load time
const Prism = lazy(() => import("./Prism"));

export interface Props {
  code: string;
  language: Language;
  className?: string;
  inTooltip?: boolean;
  // 1-based line numbers to emphasize (e.g. the overridden keys of a sparse
  // JSON value). When set, lines are wrapped and these render heavy while the
  // rest are de-emphasized (lightened), so the highlighted lines stand out
  // against Prism's already-semibold baseline.
  boldLines?: number[];
  // 1-based line numbers to tint, marking where values shown side by side
  // differ.
  highlightLines?: number[];
  // When set, matching substrings of the rendered code become links (see
  // LinkifyConfig). Used to make `@const:key` references clickable.
  linkify?: LinkifyConfig;
  // Override the rendered code font size (defaults to 0.85rem).
  fontSize?: string;
  // Tighter leading lets a dense surface (a variation card) fit more rows.
  lineHeight?: number;
  // Line number of the first line of `code`, so `boldLines` still matches when
  // `code` is one slice of a longer value (see VirtualizedCode).
  firstLineNumber?: number;
  monochrome?: boolean;
}

export default function InlineCode({
  code,
  language,
  className,
  inTooltip,
  boldLines,
  highlightLines,
  linkify,
  fontSize = "0.85rem",
  lineHeight = CODE_LINE_HEIGHT,
  firstLineNumber = 1,
  monochrome = false,
}: Props) {
  const { theme } = useAppearanceUITheme();

  const style = cloneDeep(getCodeTheme(theme, inTooltip));
  style['code[class*="language-"]'].fontSize = fontSize;
  style['code[class*="language-"]'].lineHeight = lineHeight;
  style['code[class*="language-"]'].fontWeight = CODE_FONT_WEIGHT;
  // this next line actually doesn't do anything- its overridden somewhere in Prism.
  style['code[class*="language-"]'].whiteSpace = "pre-wrap";
  style['pre[class*="language-"]'].whiteSpace = "pre-wrap";
  style['code[class*="language-"]'].overflowWrap = "anywhere";
  if (monochrome) {
    Object.values(style).forEach((s) => {
      if (s.color) s.color = "inherit";
    });
  }

  const boldLineSet = boldLines?.length ? new Set(boldLines) : null;
  const highlightLineSet = highlightLines?.length
    ? new Set(highlightLines)
    : null;
  // react-syntax-highlighter only passes a real line number to `lineProps` when
  // `showLineNumbers` is on; otherwise it passes `false`. Since `lineProps` is
  // invoked once per rendered line in top-to-bottom order, we track the line
  // index ourselves. Reset each render.
  let renderedLine = firstLineNumber - 1;

  return (
    <Suspense
      fallback={
        <PrismFallback
          language={language}
          style={style}
          className={clsx("border-0 p-0 m-0 bg-transparent", className)}
          code={code}
        />
      }
    >
      <Prism
        language={language}
        style={style}
        className={clsx("border-0 p-0 m-0 bg-transparent wrap-code", className)}
        showLineNumbers={false}
        // Wrap each line so we can bold specific ones via lineProps. Only
        // enabled when boldLines are supplied to avoid changing the default
        // (unwrapped) rendering everywhere else. NB: react-syntax-highlighter
        // overwrites a line's `className` (see createLineElement), so we style
        // via `style` instead — it's merged through and the JSON tokens carry
        // no font-weight of their own, so the heavier weight inherits down.
        wrapLines={!!boldLineSet || !!highlightLineSet}
        // A custom renderer rebuilds the token tree, turning `@const:` references
        // into links. lineProps styling is already baked into the row nodes, so
        // delegating each row to the library's createElement preserves the
        // boldLines behavior above.
        renderer={
          linkify
            ? ({ rows, stylesheet, useInlineStyles }) =>
                linkifyNodes(rows, linkify).map((node, i) =>
                  createElement({
                    node,
                    stylesheet,
                    useInlineStyles,
                    key: `code-line-${i}`,
                  }),
                )
            : undefined
        }
        lineProps={
          boldLineSet || highlightLineSet
            ? () => {
                renderedLine += 1;
                return {
                  style: {
                    // The Prism baseline is already semibold (600), so bolding
                    // alone barely reads. Instead, in this mode we keep the
                    // patched lines heavy and de-emphasize the rest so the
                    // overrides pop.
                    ...(boldLineSet && {
                      fontWeight: boldLineSet.has(renderedLine) ? 800 : 200,
                    }),
                    ...(highlightLineSet?.has(renderedLine) &&
                      HIGHLIGHTED_LINE),
                  },
                };
              }
            : undefined
        }
      >
        {code}
      </Prism>
    </Suspense>
  );
}

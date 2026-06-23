import {
  tomorrow as dark,
  ghcolors as light,
} from "react-syntax-highlighter/dist/cjs/styles/prism";
import { Suspense, lazy } from "react";
import cloneDeep from "lodash/cloneDeep";
import clsx from "clsx";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";
import { Language } from "./Code";
import PrismFallback from "./PrismFallback";

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
}

export default function InlineCode({
  code,
  language,
  className,
  inTooltip,
  boldLines,
}: Props) {
  const { theme } = useAppearanceUITheme();

  const style = cloneDeep(
    theme === "light" ? (inTooltip ? dark : light) : inTooltip ? light : dark,
  );
  style['code[class*="language-"]'].fontSize = "0.85rem";
  style['code[class*="language-"]'].lineHeight = 1.5;
  style['code[class*="language-"]'].fontWeight = 600;
  // this next line actually doesn't do anything- its overridden somewhere in Prism.
  style['code[class*="language-"]'].whiteSpace = "pre-wrap";
  style['pre[class*="language-"]'].whiteSpace = "pre-wrap";
  style['code[class*="language-"]'].overflowWrap = "anywhere";

  const boldLineSet = boldLines?.length ? new Set(boldLines) : null;
  // react-syntax-highlighter only passes a real line number to `lineProps` when
  // `showLineNumbers` is on; otherwise it passes `false`. Since `lineProps` is
  // invoked once per rendered line in top-to-bottom order, we track the line
  // index ourselves. Reset each render.
  let renderedLine = 0;

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
        wrapLines={!!boldLineSet}
        lineProps={
          boldLineSet
            ? () => {
                renderedLine += 1;
                // The Prism baseline is already semibold (600), so bolding
                // alone barely reads. Instead, in this mode we keep the patched
                // lines heavy and de-emphasize the rest so the overrides pop.
                return {
                  style: {
                    fontWeight: boldLineSet.has(renderedLine) ? 800 : 200,
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

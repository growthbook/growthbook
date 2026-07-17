import {
  Children,
  ReactElement,
  ReactNode,
  Suspense,
  isValidElement,
  lazy,
  useMemo,
} from "react";
import cloneDeep from "lodash/cloneDeep";
import {
  ghcolors as light,
  tomorrow as dark,
} from "react-syntax-highlighter/dist/cjs/styles/prism";
import { useAppearanceUITheme } from "@/services/AppearanceUIThemeProvider";

// Lazy-load the highlighter (same pattern as ./Code) so surfaces that opt
// into markdown highlighting don't pay the Prism bundle cost up front.
const Prism = lazy(() => import("./Prism"));

// Best-effort language detection for fenced blocks with no language tag.
// Prism has no built-in auto-detect, so this is a cheap content heuristic
// covering the languages people actually paste into comments: JSON, SQL,
// HTML/XML, YAML, Python, bash, and JS/TS. Returns null when nothing
// matches, in which case the block renders unhighlighted.
export function guessCodeLanguage(code: string): string | null {
  const trimmed = code.trim();
  if (!trimmed) return null;

  // JSON: starts like a JSON value and parses.
  if (/^[[{"]/.test(trimmed)) {
    try {
      JSON.parse(trimmed);
      return "json";
    } catch {
      // fall through
    }
  }
  // SQL keywords at the start of a statement.
  if (
    /^(SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|WITH)\b/im.test(trimmed)
  ) {
    return "sql";
  }
  // Markup.
  if (/^<\/?[a-zA-Z][^>]*>/.test(trimmed)) {
    return "html";
  }
  // Shell: shebang or common command prompts.
  if (
    /^#!\s*\/|^\$\s+\w|^(curl|npm|pnpm|yarn|git|cd|ls|echo)\b/m.test(trimmed)
  ) {
    return "bash";
  }
  // Python.
  if (/^(def |class \w+:|import \w+|from \w+ import )/m.test(trimmed)) {
    return "python";
  }
  // JS/TS.
  if (
    /\b(const|let|function|=>|import |export )\b/.test(trimmed) &&
    /[;{}()]/.test(trimmed)
  ) {
    return "javascript";
  }
  // YAML: "key: value" lines without braces.
  if (
    /^[\w-]+:\s/m.test(trimmed) &&
    !/[{};]/.test(trimmed) &&
    trimmed.includes("\n")
  ) {
    return "yml";
  }
  return null;
}

// Recursively flatten a react-markdown <code> element's children to the raw
// code string.
function extractText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (isValidElement(node)) {
    return extractText((node.props as { children?: ReactNode }).children ?? "");
  }
  return "";
}

// Drop-in `pre` renderer for react-markdown that syntax-highlights fenced
// code blocks. Tagged blocks (```ts) use the tag; untagged blocks go through
// `guessCodeLanguage`. Renders a plain <pre> when no language can be
// determined, and while the lazy highlighter loads. Inline code is
// unaffected (it never renders inside <pre>).
export default function MarkdownCodeBlock({
  children,
}: {
  children?: ReactNode;
}) {
  const { theme } = useAppearanceUITheme();

  // react-markdown renders fenced blocks as <pre><code className="language-x">.
  const codeEl = Children.toArray(children).find((c) => isValidElement(c)) as
    | ReactElement
    | undefined;
  const codeProps = (codeEl?.props ?? {}) as {
    className?: string;
    children?: ReactNode;
  };
  const code = extractText(codeProps.children ?? "").replace(/\n$/, "");
  const tagged = /language-(\S+)/.exec(codeProps.className || "")?.[1] ?? null;

  const language = useMemo(
    () => tagged ?? guessCodeLanguage(code),
    [tagged, code],
  );

  const style = useMemo(() => {
    const style = cloneDeep(theme === "dark" ? dark : light);
    style['code[class*="language-"]'].fontSize = "0.85rem";
    style['code[class*="language-"]'].lineHeight = 1.5;
    style['pre[class*="language-"]'].backgroundColor =
      theme === "dark" ? "transparent" : "#fff";
    style['pre[class*="language-"]'].border = "1px solid var(--slate-a4)";
    return style;
  }, [theme]);

  if (!code || !language) {
    return <pre>{children}</pre>;
  }

  return (
    <Suspense fallback={<pre>{children}</pre>}>
      <Prism language={language} style={style}>
        {code}
      </Prism>
    </Suspense>
  );
}

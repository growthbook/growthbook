import {
  createContext,
  ReactNode,
  RefObject,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Box } from "@radix-ui/themes";
import Link from "@/ui/Link";
import styles from "./ExpandableText.module.scss";

const MAX_LINES = 8;

// What keeps its own clicks inside the text.
const CONTROLS =
  "a, button, input, textarea, select, [contenteditable='true'], [role='menuitem']";

const Expansion = createContext({ expanded: false, expand: () => {} });

// The height of its first MAX_LINES lines as it resizes, or null when it has
// no more than that.
function useClampHeight(ref: RefObject<HTMLElement>): number | null {
  const [height, setHeight] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      // Its own height, not its scroll height, which counts a hover tint
      // reaching past it.
      const full = el.offsetHeight;
      // Clamped by lines for a moment, so the cut falls between two whatever
      // their heights; drawn that way, it would add its own ellipsis.
      const style = el.style.cssText;
      el.style.cssText += `display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: ${MAX_LINES}; overflow: hidden;`;
      const clamped = el.offsetHeight;
      el.style.cssText = style;
      setHeight(full > clamped + 1 ? clamped : null);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return height;
}

/**
 * Text that's cut off opens from its "… expand" link, or with `expandOnClick`
 * from a click anywhere on it but a control. It closes again on a click
 * anywhere else, after that click has landed, so the click isn't moved.
 */
export default function ExpandableText({
  expandOnClick = true,
  children,
}: {
  // Off where a click on it already does something, like a row that edits.
  expandOnClick?: boolean;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!expanded) return;
    const close = (e: MouseEvent) => {
      // Not a click inside it, nor one ending a selection let go past it.
      if (
        (e.target instanceof Node && ref.current?.contains(e.target)) ||
        !window.getSelection()?.isCollapsed
      ) {
        return;
      }
      setExpanded(false);
    };
    document.addEventListener("click", close, true);
    return () => document.removeEventListener("click", close, true);
  }, [expanded]);

  return (
    <Expansion.Provider value={{ expanded, expand: () => setExpanded(true) }}>
      <div
        ref={ref}
        className={expandOnClick ? styles.expandsOnClick : undefined}
        onClick={(e) => {
          // A click that ends a text selection isn't one.
          if (
            !expandOnClick ||
            (e.target instanceof Element && e.target.closest(CONTROLS)) ||
            !window.getSelection()?.isCollapsed
          ) {
            return;
          }
          setExpanded(true);
        }}
      >
        {children}
      </div>
    </Expansion.Provider>
  );
}

// The text itself, past MAX_LINES cut off with a link to the rest.
export function ExpandableTextBody({ children }: { children: ReactNode }) {
  const content = useRef<HTMLDivElement>(null);
  const clampHeight = useClampHeight(content);
  const { expanded, expand } = useContext(Expansion);
  const clamped = clampHeight !== null && !expanded;

  return (
    <Box position="relative">
      <Box
        className={clamped ? styles.clamped : undefined}
        style={{
          maxHeight: clamped
            ? `calc(${clampHeight}px + 2 * var(--space-1))`
            : undefined,
          overflow: "hidden",
          // Room for a row's hover tint, which reaches past the row
          // (hover-highlight's default bleed), without moving the contents.
          margin: "calc(-1 * var(--space-1)) calc(-1 * var(--space-2))",
          padding: "var(--space-1) var(--space-2)",
        }}
      >
        <div ref={content}>{children}</div>
      </Box>
      {clamped ? (
        <Link size="sm" className={styles.more} onClick={expand}>
          … expand
        </Link>
      ) : null}
    </Box>
  );
}

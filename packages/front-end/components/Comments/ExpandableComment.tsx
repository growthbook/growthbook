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
import styles from "./ExpandableComment.module.scss";

const MAX_LINES = 8;

// What keeps its own clicks inside a comment.
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

// A comment whose body is cut off opens when clicked anywhere but a control,
// and closes again once focus leaves it.
export default function ExpandableComment({
  children,
}: {
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Expansion.Provider value={{ expanded, expand: () => setExpanded(true) }}>
      <div
        tabIndex={-1}
        className={styles.comment}
        onClick={(e) => {
          // A click that ends a text selection isn't one.
          if (
            (e.target instanceof Element && e.target.closest(CONTROLS)) ||
            !window.getSelection()?.isCollapsed
          ) {
            return;
          }
          setExpanded(true);
        }}
        onBlur={(e) => {
          // Not when the window itself loses focus.
          if (
            !document.hasFocus() ||
            (e.relatedTarget instanceof Node &&
              e.currentTarget.contains(e.relatedTarget))
          ) {
            return;
          }
          setExpanded(false);
        }}
      >
        {children}
      </div>
    </Expansion.Provider>
  );
}

// The comment's body, past MAX_LINES cut off with a link to the rest.
export function ExpandableCommentBody({ children }: { children: ReactNode }) {
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
        <Link className={styles.more} onClick={expand}>
          … more
        </Link>
      ) : null}
    </Box>
  );
}

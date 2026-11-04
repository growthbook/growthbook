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
import clsx from "clsx";
import Link from "@/ui/Link";
import styles from "./ExpandableText.module.scss";

// How many lines show while it's cut off.
export const CLAMPED_LINES = 8;

// What keeps its own clicks inside the text.
const CONTROLS =
  "a, button, input, textarea, select, [contenteditable='true'], [role='menuitem']";

const Expansion = createContext({ expanded: false, expand: () => {} });

// The height of its first CLAMPED_LINES lines as it resizes, or null when it has
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
      el.style.cssText += `display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: ${CLAMPED_LINES}; overflow: hidden;`;
      let clamped = el.offsetHeight;
      el.style.cssText = style;
      // Laid out in rows rather than lines of text (flex, grid), it isn't
      // clamped by lines, so it's cut within as many lines' height, under the
      // lowest thing that still fits whole: between two rows.
      const limit = CLAMPED_LINES * parseFloat(getComputedStyle(el).lineHeight);
      if (clamped >= full - 1 && full > limit) {
        const top = el.getBoundingClientRect().top;
        clamped = 0;
        el.querySelectorAll("*").forEach((node) => {
          const bottom = node.getBoundingClientRect().bottom - top;
          if (bottom <= limit && bottom > clamped) clamped = bottom;
        });
        if (!clamped) clamped = limit;
      }
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

/**
 * Whether the text is open, for what's costly to build in full while only its
 * first lines show: past CLAMPED_LINES, it can wait to build the rest.
 */
export function useTextExpanded() {
  return useContext(Expansion).expanded;
}

// The text itself, past CLAMPED_LINES cut off with a link to the rest.
export function ExpandableTextBody({
  linkBelow = false,
  children,
}: {
  // The link on its own line under the text, at its start, where the lines
  // end short (as rows do) and one at the end would be missed.
  linkBelow?: boolean;
  children: ReactNode;
}) {
  const content = useRef<HTMLDivElement>(null);
  const clampHeight = useClampHeight(content);
  const { expanded, expand } = useContext(Expansion);
  const clamped = clampHeight !== null && !expanded;

  return (
    <Box position="relative">
      <Box
        className={
          clamped ? (linkBelow ? styles.fadesOut : styles.clamped) : undefined
        }
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
        <Link
          size="sm"
          className={clsx(styles.more, !linkBelow && styles.atLineEnd)}
          onClick={expand}
        >
          … expand
        </Link>
      ) : null}
    </Box>
  );
}

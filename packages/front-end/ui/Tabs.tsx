import clsx from "clsx";
import {
  Children,
  ComponentPropsWithoutRef,
  createContext,
  CSSProperties,
  forwardRef,
  isValidElement,
  MutableRefObject,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Box, Tabs as RadixTabs } from "@radix-ui/themes";
import { PiCaretDown } from "react-icons/pi";
import useURLHash from "@/hooks/useURLHash";
import { radixSize, Size } from "@/ui/sizes";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import { TABS_HEADER_HEIGHT_PX } from "@/components/Layout/constants";

/**
 * See more examples in design-system/index.tsx
 *
 * Simple usage:
 * ```tsx
 * <Tabs defaultValue="tab1">
 *   <TabsList>
 *     <TabsTrigger value="tab1">Tab 1</TabsTrigger>
 *     <TabsTrigger value="tab2">Tab 2</TabsTrigger>
 *   </TabsList>
 *   <TabsContent value="tab1">Content for tab 1</TabsContent>
 *   <TabsContent value="tab2">Content for tab 2</TabsContent>
 * </Tabs>
 * ```
 */

// The open tab, and how to open another, for the overflow menu.
const TabsValueContext = createContext<{
  value: string | null;
  setValue: ((value: string) => void) | null;
}>({ value: null, setValue: null });

type OverflowEntry = {
  el: HTMLButtonElement;
  label: ReactNode;
  disabled: boolean;
};

const TabsOverflowContext = createContext<{
  entries: MutableRefObject<Map<string, OverflowEntry>>;
  remeasure: () => void;
  hidden: ReadonlySet<string>;
} | null>(null);

type ControlledTabsProps = {
  defaultValue?: never;
  value?: string;
  persistInURL?: never;
};

type UncontrolledTabsProps = {
  defaultValue?: string;
  value?: never;
  persistInURL?: boolean;
};

type TabsProps = (ControlledTabsProps | UncontrolledTabsProps) &
  Omit<React.ComponentProps<typeof RadixTabs.Root>, "defaultValue" | "value">;

export const Tabs = forwardRef<HTMLDivElement, TabsProps>(function Tabs(
  {
    children,
    defaultValue,
    value,
    onValueChange,
    persistInURL = false,
    ...props
  }: TabsProps,
  ref,
) {
  let rootProps: React.ComponentProps<typeof RadixTabs.Root> = {};

  const [urlHash, setUrlHash] = useURLHash();
  // Held here rather than by Radix, so the overflow menu can open a tab too.
  const [innerValue, setInnerValue] = useState(defaultValue);

  if (defaultValue && persistInURL) {
    const possibleValues = new Set<string>();
    Children.forEach(children, (child) => {
      if (isValidElement(child) && child.props.value) {
        possibleValues.add(child.props.value);
      } else if (
        isValidElement(child) &&
        child.props &&
        typeof child.props === "object" &&
        "children" in child.props &&
        Array.isArray(child.props.children)
      ) {
        // If the child is a TabsTrigger, check its children for a value
        child.props.children.forEach((c: ReactNode) => {
          if (
            isValidElement(c) &&
            c.props.value &&
            typeof c.props.value === "string"
          ) {
            possibleValues.add(c.props.value);
          }
        });
      }
      return null;
    });

    rootProps = {
      value:
        urlHash && (possibleValues.has(urlHash) || !possibleValues.size)
          ? urlHash
          : defaultValue,
      onValueChange: (value) => {
        setUrlHash(value as string);
        onValueChange?.(value);
      },
    };
  } else if (defaultValue) {
    rootProps = {
      value: innerValue,
      onValueChange: (value) => {
        setInnerValue(value);
        onValueChange?.(value);
      },
    };
  } else if (value) {
    rootProps = {
      value,
      onValueChange,
    };
  }

  return (
    <TabsValueContext.Provider
      value={{
        value: rootProps.value ?? null,
        setValue: rootProps.onValueChange ?? null,
      }}
    >
      <RadixTabs.Root {...rootProps} {...props} ref={ref}>
        {children}
      </RadixTabs.Root>
    </TabsValueContext.Provider>
  );
});

// A menu trigger with a tab's own look, so it reads as one of the tabs. It
// takes its size from the tab list, so it goes inside one.
export const TabsMoreTrigger = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<"button">
>(function TabsMoreTrigger({ children, className, style, ...props }, ref) {
  const label = (
    <>
      {children}
      <PiCaretDown style={{ marginLeft: 4 }} />
    </>
  );
  return (
    <button
      ref={ref}
      type="button"
      className={clsx(
        "rt-reset rt-BaseTabListTrigger rt-TabsTrigger",
        className,
      )}
      // Last in its bar, its pill sits on the bar's edge, not a padding in.
      style={{ flexShrink: 0, paddingRight: 0, ...style }}
      {...props}
    >
      <span className="rt-BaseTabListTriggerInner">{label}</span>
      {/* Radix sizes a tab by this unseen copy of its label. */}
      <span className="rt-BaseTabListTriggerInnerHidden">{label}</span>
    </button>
  );
});

type TabsListProps = Omit<
  React.ComponentProps<typeof RadixTabs.List>,
  "size"
> & {
  size?: Size<"sm" | "md" | "lg">;
  // Tabs past the list's width fold into a More menu, all but the open one.
  // Off, the list scrolls sideways instead.
  overflowMenu?: boolean;
};

// Until the More button has rendered and can be measured.
const MORE_WIDTH_ESTIMATE_PX = 80;

// A width in the list's own layout pixels, as clientWidth counts them, however
// a transform or zoom around the list scales it on screen.
function layoutWidth(node: Element, list: HTMLElement) {
  const scale = list.getBoundingClientRect().width / list.offsetWidth || 1;
  return node.getBoundingClientRect().width / scale;
}

export const TabsList = forwardRef<HTMLDivElement, TabsListProps>(
  function TabsList(
    { children, size = "md", className, overflowMenu = true, ...props },
    ref,
  ) {
    // Radix tab lists stop at size "2", so lg is that step plus the
    // .rt-BaseTabList.rt-r-size-3 rule in styles/global-radix-overrides.scss.
    const sizeValue = size === "lg" ? "2" : radixSize(size);
    const classNameValue = size === "lg" ? "rt-r-size-3" : "";

    const { value: active, setValue } = useContext(TabsValueContext);
    const enabled = overflowMenu && setValue !== null;

    const list = useRef<HTMLDivElement | null>(null);
    const setListRef = useCallback(
      (el: HTMLDivElement | null) => {
        list.current = el;
        if (typeof ref === "function") ref(el);
        else if (ref) ref.current = el;
      },
      [ref],
    );
    const entries = useRef(new Map<string, OverflowEntry>());
    // Hidden tabs measure 0, so each keeps the width it had when shown.
    const widths = useRef(new Map<string, number>());
    const more = useRef<HTMLButtonElement>(null);
    const moreWidth = useRef(MORE_WIDTH_ESTIMATE_PX);
    const [hidden, setHidden] = useState<string[]>([]);
    const [registered, setRegistered] = useState(0);
    const remeasure = useCallback(() => setRegistered((n) => n + 1), []);

    const measure = useCallback(() => {
      const el = list.current;
      if (!el) return;
      const tabs = [...entries.current.entries()].sort(([, a], [, b]) =>
        a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING
          ? -1
          : 1,
      );
      for (const [value, entry] of tabs) {
        const w = layoutWidth(entry.el, el);
        if (w > 0) widths.current.set(value, w);
      }
      const width = (value: string) => widths.current.get(value) ?? 0;
      const total = tabs.reduce((sum, [value]) => sum + width(value), 0);
      // Anything else in the list, such as a button after the tabs, keeps its
      // room; the tabs share what's left.
      const others = Array.from(el.children).reduce(
        (sum, child) =>
          (more.current && child.contains(more.current)) ||
          tabs.some(([, entry]) => child.contains(entry.el))
            ? sum
            : sum + layoutWidth(child, el),
        0,
      );
      const available = el.clientWidth - others;

      const next: string[] = [];
      // 1px of slack for sub-pixel widths against the rounded clientWidth.
      if (total > available + 1) {
        let room =
          available -
          moreWidth.current -
          (active !== null && entries.current.has(active) ? width(active) : 0);
        // Once one tab doesn't fit, the rest go too, so the order holds.
        let full = false;
        for (const [value] of tabs) {
          if (value === active) continue;
          if (!full && width(value) <= room) room -= width(value);
          else {
            full = true;
            next.push(value);
          }
        }
      }
      setHidden((prev) =>
        prev.length === next.length && prev.every((v, i) => v === next[i])
          ? prev
          : next,
      );
    }, [active]);

    useLayoutEffect(() => {
      if (enabled) measure();
    }, [enabled, measure, registered]);

    useLayoutEffect(() => {
      const w =
        more.current && list.current
          ? layoutWidth(more.current, list.current)
          : 0;
      if (w && Math.abs(w - moreWidth.current) > 1) {
        moreWidth.current = w;
        measure();
      }
    }, [hidden, measure]);

    useEffect(() => {
      const el = list.current;
      if (!enabled || !el) return;
      const observer = new ResizeObserver(() => measure());
      observer.observe(el);
      // A tab's own width can change too, as a count in it does.
      entries.current.forEach((entry) => observer.observe(entry.el));
      return () => observer.disconnect();
    }, [enabled, measure, registered]);

    const overflow = useMemo(
      () => (enabled ? { entries, remeasure, hidden: new Set(hidden) } : null),
      [enabled, remeasure, hidden],
    );

    return (
      <TabsOverflowContext.Provider value={overflow}>
        <RadixTabs.List
          className={clsx(classNameValue, className)}
          size={sizeValue}
          {...props}
          ref={setListRef}
        >
          {children}
          {enabled && hidden.length > 0 ? (
            <DropdownMenu
              menuPlacement="end"
              trigger={
                <TabsMoreTrigger ref={more}>
                  More ({hidden.length})
                </TabsMoreTrigger>
              }
            >
              {hidden.map((value) => {
                const entry = entries.current.get(value);
                return (
                  <DropdownMenuItem
                    key={value}
                    disabled={entry?.disabled}
                    onClick={() => setValue?.(value)}
                  >
                    {entry?.label ?? value}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenu>
          ) : null}
        </RadixTabs.List>
      </TabsOverflowContext.Provider>
    );
  },
);

type StickyTabsListProps = { pinnedClass?: string } & TabsListProps;

export const StickyTabsList = forwardRef<HTMLDivElement, StickyTabsListProps>(
  function StickyTabsList({ pinnedClass = "pinned", ...props }, ref) {
    const tabsRef = useRef<HTMLDivElement>(null);
    const [headerPinned, setHeaderPinned] = useState(false);

    useEffect(() => {
      const observer = new IntersectionObserver(
        ([entry]) => {
          setHeaderPinned(entry.intersectionRatio < 1);
        },
        {
          root: null, // Use the viewport as the root
          rootMargin: `-${TABS_HEADER_HEIGHT_PX}px`,
          threshold: 0.01, // Trigger when first pixel leaves
        },
      );
      if (tabsRef.current) {
        observer.observe(tabsRef.current);
      }
      return () => observer.disconnect();
    }, []);

    return (
      <Box
        className={`${headerPinned ? pinnedClass || "" : ""} tabwrap sticky`}
        style={{ top: TABS_HEADER_HEIGHT_PX + "px" }}
      >
        {/* This is needed as for some reason the intersection observer doesn't work on the position:sticky element-even with the right margin offsets. */}
        <Box
          ref={tabsRef}
          style={{
            position: "absolute",
            top: -1,
          }}
        ></Box>
        <TabsList {...props} ref={ref} />
      </Box>
    );
  },
);

export const TabsTrigger = forwardRef<
  HTMLButtonElement,
  React.ComponentProps<typeof RadixTabs.Trigger>
>(function TabsTrigger({ children, style, ...props }, ref) {
  const { value, disabled } = props;
  const overflow = useContext(TabsOverflowContext);
  const entries = overflow?.entries;
  const remeasure = overflow?.remeasure;

  const own = useRef<HTMLButtonElement | null>(null);
  const setRef = useCallback(
    (el: HTMLButtonElement | null) => {
      own.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref) ref.current = el;
    },
    [ref],
  );

  // Every render, so the menu shows the label as it is now.
  useLayoutEffect(() => {
    if (entries && own.current) {
      entries.current.set(value, {
        el: own.current,
        label: children,
        disabled: !!disabled,
      });
    }
  });
  useLayoutEffect(() => {
    if (!entries || !remeasure) return;
    const map = entries.current;
    remeasure();
    return () => {
      map.delete(value);
      remeasure();
    };
  }, [entries, remeasure, value]);

  const hiddenStyle: CSSProperties | undefined = overflow?.hidden.has(value)
    ? { ...style, display: "none" }
    : style;

  return (
    <RadixTabs.Trigger {...props} style={hiddenStyle} ref={setRef}>
      {children}
    </RadixTabs.Trigger>
  );
});

export const TabsContent = forwardRef<
  HTMLDivElement,
  React.ComponentProps<typeof RadixTabs.Content>
>(function TabsContent({ children, ...props }, ref) {
  return (
    <RadixTabs.Content {...props} ref={ref}>
      {children}
    </RadixTabs.Content>
  );
});

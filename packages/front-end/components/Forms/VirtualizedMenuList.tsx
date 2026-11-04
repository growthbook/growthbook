import {
  Children,
  cloneElement,
  isValidElement,
  MutableRefObject,
  ReactElement,
  ReactNode,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { components, GroupBase, MenuListProps } from "react-select";
import { useVirtualizer } from "@tanstack/react-virtual";

// Menus up to this many rows render as usual; past it only the rows near the
// scroll position mount
const VIRTUALIZE_AFTER_ROWS = 100;
const ESTIMATED_ROW_HEIGHT = 36;

type Row = { element: ReactElement; isHeading: boolean };

// Options, and groups split into their heading plus one row per option
function flattenRows(children: ReactNode): Row[] {
  const rows: Row[] = [];
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const props = child.props as {
      headingProps?: unknown;
      children?: ReactNode;
    };
    if (props.headingProps === undefined) {
      rows.push({ element: child, isHeading: false });
      return;
    }
    rows.push({
      element: cloneElement(child as ReactElement<{ children?: ReactNode }>, {
        children: null,
      }),
      isHeading: true,
    });
    Children.forEach(props.children, (option) => {
      if (isValidElement(option))
        rows.push({ element: option, isHeading: false });
    });
  });
  return rows;
}

export default function VirtualizedMenuList<
  Option,
  IsMulti extends boolean,
  Group extends GroupBase<Option>,
>(props: MenuListProps<Option, IsMulti, Group>) {
  const rows = useMemo(() => flattenRows(props.children), [props.children]);
  const virtualize = rows.length > VIRTUALIZE_AFTER_ROWS;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: virtualize ? rows.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    overscan: 8,
  });

  // react-select scrolls the focused option into view through its DOM node,
  // which may not be mounted, so arrow keys go through the virtualizer
  const focusedIndex = virtualize
    ? rows.findIndex(
        (row) => (row.element.props as { isFocused?: boolean }).isFocused,
      )
    : -1;
  useEffect(() => {
    if (focusedIndex >= 0) virtualizer.scrollToIndex(focusedIndex);
  }, [focusedIndex, virtualizer]);

  if (!virtualize) return <components.MenuList {...props} />;

  const items = virtualizer.getVirtualItems();
  const paddingTop = items[0]?.start ?? 0;
  const paddingBottom = virtualizer.getTotalSize() - (items.at(-1)?.end ?? 0);

  return (
    <components.MenuList
      {...props}
      innerRef={(el) => {
        scrollRef.current = el;
        const { innerRef } = props;
        if (typeof innerRef === "function") innerRef(el);
        else if (innerRef)
          (innerRef as MutableRefObject<HTMLDivElement | null>).current = el;
      }}
    >
      <div style={{ paddingTop, paddingBottom }}>
        {items.map((item) => (
          <div
            key={item.index}
            data-index={item.index}
            ref={virtualizer.measureElement}
            style={{
              // Keeps group heading margins inside the measured row
              display: "flow-root",
              // Every flattened group is its own first-of-type, so later
              // headings get back the gap react-select.scss gives them
              paddingTop:
                rows[item.index].isHeading && item.index > 0
                  ? "calc(var(--space-4) - var(--space-1))"
                  : undefined,
            }}
          >
            {rows[item.index].element}
          </div>
        ))}
      </div>
    </components.MenuList>
  );
}

import { ReactNode, useEffect, useRef, useState } from "react";
import { Box, Flex, FlexProps } from "@radix-ui/themes";

// PROTOTYPE (set in review; with the docked GrowthBot rail, list pages got
// narrower): a list page's search box and its filters, on one row while
// they fit: the search takes the space the filters leave, up to 40%, no
// narrower than 160px. When they don't fit, the search takes the whole
// first row and the filters move, intact on one line, to the row below
// (tried: the filters wrapping among themselves, which they did too early,
// and the search shrinking alone, which let the filters run off the page).
export default function SearchFilterRow({
  search,
  filters,
  mb,
}: {
  search: ReactNode;
  filters: ReactNode;
  mb?: FlexProps["mb"];
}) {
  const searchRef = useRef<HTMLDivElement>(null);
  const filtersRef = useRef<HTMLDivElement>(null);
  // Whether the filters have moved to the row below.
  const [wrapped, setWrapped] = useState(false);
  useEffect(() => {
    const searchEl = searchRef.current;
    const filtersEl = filtersRef.current;
    if (!searchEl || !filtersEl) return;
    // Below it: the filters' top under the search's bottom (their tops
    // differ on one row too, as they're centred and not the same height).
    const check = () =>
      setWrapped(
        filtersEl.getBoundingClientRect().top >=
          searchEl.getBoundingClientRect().bottom - 1,
      );
    check();
    const observer = new ResizeObserver(check);
    observer.observe(searchEl);
    observer.observe(filtersEl);
    if (searchEl.parentElement) observer.observe(searchEl.parentElement);
    return () => observer.disconnect();
  }, []);

  return (
    <Flex align="center" justify="between" gap="3" wrap="wrap" mb={mb}>
      <Box
        ref={searchRef}
        style={{
          // Its width from what's left, so it's what gives way; whether the
          // row wraps is decided at its 160px minimum.
          flex: "1 1 0",
          minWidth: 160,
          maxWidth: wrapped ? "100%" : "40%",
        }}
      >
        {search}
      </Box>
      <Box
        ref={filtersRef}
        style={{
          flexShrink: 0,
          // On the row below, 4px more above and below them (set in
          // review).
          padding: wrapped ? "4px 0" : undefined,
        }}
      >
        {filters}
      </Box>
    </Flex>
  );
}

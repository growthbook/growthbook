import { ReactNode, useEffect, useRef, useState } from "react";
import { Box, Flex, FlexProps } from "@radix-ui/themes";

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
  const [wrapped, setWrapped] = useState(false);
  useEffect(() => {
    const searchEl = searchRef.current;
    const filtersEl = filtersRef.current;
    if (!searchEl || !filtersEl) return;
    // Their tops differ on one row too: they're centered and not the same
    // height.
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
          // No wider than the row, so filters that wrap (Feature Flags') do.
          maxWidth: "100%",
          padding: wrapped ? "4px 0" : undefined,
        }}
      >
        {filters}
      </Box>
    </Flex>
  );
}

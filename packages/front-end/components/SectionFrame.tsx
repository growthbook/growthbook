import { ReactNode, useEffect, useRef, useState } from "react";
import { Box, BoxProps, Flex } from "@radix-ui/themes";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";

/**
 * A page section in a card, under a header: its title and actions, then any
 * tabs, over a rule across the card.
 */
export default function SectionFrame({
  title,
  actions,
  tabs,
  stickyTop,
  className,
  children,
  mt,
}: {
  title: ReactNode;
  actions?: ReactNode;
  // Their underline meets the header's rule.
  tabs?: ReactNode;
  // The header sticks this far below the window's top while the card scrolls.
  stickyTop?: number;
  className?: string;
  children: ReactNode;
} & Pick<BoxProps, "mt">) {
  const sticky = stickyTop !== undefined;
  const sentinel = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const el = sentinel.current;
    if (stickyTop === undefined || !el) return;
    const observer = new IntersectionObserver(
      ([entry]) =>
        setStuck(
          !entry.isIntersecting && entry.boundingClientRect.top < stickyTop,
        ),
      { rootMargin: `-${stickyTop}px 0px 0px 0px` },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [stickyTop]);

  return (
    <Frame px="0" py="0" mt={mt} className={className}>
      {sticky ? <div ref={sentinel} aria-hidden /> : null}
      <Box
        style={{
          // Stuck, the page tab bar's own pinned shadow in place of the rule.
          boxShadow: stuck
            ? "0 1px 2px var(--lift-shadow-near), 0 4px 4px var(--lift-shadow-far)"
            : "inset 0 -1px 0 0 var(--gray-a5)",
          ...(sticky && {
            position: "sticky",
            top: stickyTop,
            zIndex: 10,
            background: "var(--color-panel-solid)",
            // Square once stuck, a bar across the top.
            borderTopLeftRadius: stuck ? 0 : "inherit",
            borderTopRightRadius: stuck ? 0 : "inherit",
          }),
        }}
      >
        <Flex
          align="center"
          justify="between"
          gap="4"
          px="6"
          pt="4"
          // Tighter over tabs, which bring their own height.
          pb={tabs ? "1" : "4"}
        >
          <Heading as="h4" size="md" mb="0">
            {title}
          </Heading>
          {actions ? (
            <Flex align="center" gap="3" flexShrink="0">
              {actions}
            </Flex>
          ) : null}
        </Flex>
        {tabs ? <Box px="6">{tabs}</Box> : null}
      </Box>
      <Box px="6" py="5">
        {children}
      </Box>
    </Frame>
  );
}

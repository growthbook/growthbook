import { ReactNode, useEffect, useRef, useState } from "react";
import { Box, BoxProps, Flex } from "@radix-ui/themes";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";

/**
 * A page section in a card, under a header: its title and actions, then any
 * tabs, over a rule across the card.
 */
export default function SectionFrame({
  title,
  titleAddon,
  actions,
  tabs,
  stickyTop,
  footnote,
  className,
  children,
  mt,
  mb,
}: {
  title: ReactNode;
  // Beside the title, before the actions on the right.
  titleAddon?: ReactNode;
  actions?: ReactNode;
  // Their underline meets the header's rule.
  tabs?: ReactNode;
  // The header sticks this far below the window's top while the card scrolls.
  stickyTop?: number;
  // A small note at the card's foot, right-aligned under its content.
  footnote?: ReactNode;
  className?: string;
  children: ReactNode;
} & Pick<BoxProps, "mt" | "mb">) {
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
    <Frame px="0" py="0" mt={mt} mb={mb} className={className}>
      {sticky ? <div ref={sentinel} aria-hidden /> : null}
      <Box
        style={{
          // Its rule stays when stuck, as the page's tabs keep theirs.
          boxShadow: "inset 0 -1px 0 0 var(--gray-a5)",
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
          px="5"
          // Over tabs, roomier on top and tighter below, where the tabs bring
          // their own height.
          pt={tabs ? "3" : "2"}
          pb={tabs ? "1" : "2"}
        >
          {/* As tall as an action button, so headers match whatever they hold
              and don't grow when a late addon (a sparkline) arrives. */}
          <Flex align="center" gap="4" minWidth="0" minHeight="32px">
            <Heading as="h4" size="md" mb="0">
              {title}
            </Heading>
            {titleAddon}
          </Flex>
          {actions ? (
            <Flex align="center" gap="3" flexShrink="0">
              {actions}
            </Flex>
          ) : null}
        </Flex>
        {tabs ? <Box px="5">{tabs}</Box> : null}
      </Box>
      <Box px="5" pt="4" pb={footnote ? "0" : "4"}>
        {children}
      </Box>
      {footnote ? (
        <Box px="5" pt="3" pb="3">
          <Text as="p" size="sm" color="text-low" align="right" mb="0">
            {footnote}
          </Text>
        </Box>
      ) : null}
    </Frame>
  );
}

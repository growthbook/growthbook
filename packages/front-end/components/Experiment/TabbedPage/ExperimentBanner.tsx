import { ReactNode, useState } from "react";
import { Box, Flex, Separator } from "@radix-ui/themes";
import { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { PiCaretDown, PiCaretRight } from "react-icons/pi";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Collapse from "@/ui/Collapse";
import { revealedByQuickEdit, revealsQuickEdit } from "./QuickEditButton";

type Props = {
  headline: ReactNode;
  // Revealed on hover, at the headline's end.
  hoverAction?: ReactNode;
  // Behind a "View details" toggle.
  details?: ReactNode;
  // Always shown, under the headline.
  children?: ReactNode;
} & MarginProps;

// The compact card the experiment page's outcome banners share.
export default function ExperimentBanner({
  headline,
  hoverAction,
  details,
  children,
  ...margin
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <Box className={hoverAction ? revealsQuickEdit : undefined} {...margin}>
      <Callout
        status="info"
        icon={null}
        style={{ paddingBlock: "var(--space-2)" }}
      >
        <Flex align="center" justify="between" gap="3" minHeight="28px">
          <Flex align="center" gap="2" wrap="wrap" minWidth="0">
            {headline}
          </Flex>
          {hoverAction ? (
            <span className={revealedByQuickEdit}>{hoverAction}</span>
          ) : null}
          {details ? (
            <Button
              variant="ghost"
              size="sm"
              icon={open ? <PiCaretDown /> : <PiCaretRight />}
              iconPosition="right"
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              {open ? "Hide details" : "View details"}
            </Button>
          ) : null}
        </Flex>
        {details ? (
          <Collapse open={open}>
            <BannerBody>{details}</BannerBody>
          </Collapse>
        ) : null}
        {children ? <BannerBody>{children}</BannerBody> : null}
      </Callout>
    </Box>
  );
}

function BannerBody({ children }: { children: ReactNode }) {
  return (
    <Box my="1" style={{ color: "var(--color-text-mid)" }}>
      <Separator
        size="4"
        my="2"
        style={{ backgroundColor: "var(--gray-a4)" }}
      />
      {children}
    </Box>
  );
}

import { useEffect, useRef, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { Responsive } from "@radix-ui/themes/props";
import { Size } from "@/ui/sizes";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import VariationNumber from "@/ui/VariationNumber";

export interface VariationLabelProps {
  number: number;
  name: string;
  size?: Size<"sm" | "md" | "lg">;
  // Constrain the label width; the name truncates (with tooltip) to fit.
  maxWidth?: Responsive<string>;
  // Set when rendered inside an element that already has a tooltip, to avoid nesting.
  disableTooltip?: boolean;
}

// Hide truncated names below this width, but keep shorter names that fully fit.
const MIN_NAME_WIDTH_PX = 24;
// Matches the Flex `gap="1"` between the number and the name.
const FLEX_GAP_PX = 4;

export default function VariationLabel({
  number,
  name,
  size = "md",
  maxWidth,
  disableTooltip = false,
}: VariationLabelProps) {
  // Root always fills the available width so the ResizeObserver re-measures on grow.
  const rootRef = useRef<HTMLDivElement>(null);
  const numberRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [hideName, setHideName] = useState(false);
  const [isTruncated, setIsTruncated] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const measure = () => {
      const rootWidth = root.clientWidth;
      const numberWidth = numberRef.current?.offsetWidth ?? 0;
      const availableNameWidth = rootWidth - numberWidth - FLEX_GAP_PX;
      // Hidden text remains mounted so its full width stays measurable.
      const fullNameWidth = textRef.current?.scrollWidth ?? 0;
      const fitsEntirely = availableNameWidth >= fullNameWidth;
      setHideName(
        rootWidth > 0 &&
          !fitsEntirely &&
          availableNameWidth < MIN_NAME_WIDTH_PX,
      );
      setIsTruncated(!fitsEntirely);
    };

    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [name, size, number]);

  const content = (
    <Flex align="center" gap="1" minWidth="0">
      <VariationNumber ref={numberRef} number={number} />
      <Box
        minWidth="0"
        flexGrow={hideName ? "0" : "1"}
        width={hideName ? "0" : undefined}
        overflow="hidden"
      >
        <Text
          ref={textRef}
          as="div"
          size={size}
          weight={size === "lg" ? "medium" : "semibold"}
          color="text-mid"
          truncate
        >
          {name}
        </Text>
      </Box>
    </Flex>
  );

  if (disableTooltip) {
    return (
      <Box ref={rootRef} minWidth="0" maxWidth={maxWidth}>
        {content}
      </Box>
    );
  }

  return (
    <Box ref={rootRef} minWidth="0" maxWidth={maxWidth}>
      <Tooltip content={name} enabled={hideName || isTruncated} side="top">
        {content}
      </Tooltip>
    </Box>
  );
}

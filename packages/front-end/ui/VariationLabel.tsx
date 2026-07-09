import { useEffect, useRef, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import VariationNumber from "@/ui/VariationNumber";

export interface VariationLabelProps {
  number: number;
  name: string;
  size?: "small" | "medium" | "large";
  // Set when rendered inside an element that already has a tooltip, to avoid nesting.
  disableTooltip?: boolean;
}

// Below this name width, hide the name and show only the number (tooltip reveals it).
const MIN_NAME_WIDTH_PX = 24;
// Matches the Flex `gap="1"` between the number and the name.
const FLEX_GAP_PX = 4;

export default function VariationLabel({
  number,
  name,
  size = "medium",
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
      const nameWidth = rootWidth - numberWidth - FLEX_GAP_PX;
      setHideName(rootWidth > 0 && nameWidth < MIN_NAME_WIDTH_PX);
      const text = textRef.current;
      setIsTruncated(!!text && text.scrollWidth > text.clientWidth);
    };

    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [name, size, number, hideName]);

  const variationNumber = <VariationNumber ref={numberRef} number={number} />;

  const content = (
    <Flex align="center" gap="1" minWidth="0">
      {variationNumber}
      <Box minWidth="0" flexGrow="1" overflow="hidden">
        {!hideName ? (
          <Text
            ref={textRef}
            as="div"
            size={size}
            weight={size === "large" ? "medium" : "semibold"}
            color="text-mid"
            truncate
          >
            {name}
          </Text>
        ) : null}
      </Box>
    </Flex>
  );

  if (disableTooltip) {
    return (
      <Box ref={rootRef} minWidth="0">
        {content}
      </Box>
    );
  }

  return (
    <Box ref={rootRef} minWidth="0">
      <Tooltip content={name} enabled={hideName || isTruncated} side="top">
        {hideName ? variationNumber : content}
      </Tooltip>
    </Box>
  );
}

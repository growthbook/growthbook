import { useEffect, useRef, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import Text from "@/ui/Text";
import Tooltip from "@/components/Tooltip/Tooltip";
import VariationNumber from "@/ui/VariationNumber";

export interface VariationLabelProps {
  number: number;
  name: string;
  size?: "small" | "medium" | "large";
  // The tooltip only reveals the name when it is truncated or hidden. Set this
  // when the label is rendered inside an element that already has its own
  // tooltip, to avoid a nested/duplicate tooltip.
  disableTooltip?: boolean;
}

// Below this available width (px) for the name, we drop the name entirely and
// show only the VariationNumber, relying on the tooltip to reveal the name.
const MIN_NAME_WIDTH_PX = 24;

export default function VariationLabel({
  number,
  name,
  size = "medium",
  disableTooltip = false,
}: VariationLabelProps) {
  const slotRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [hideName, setHideName] = useState(false);
  const [isTruncated, setIsTruncated] = useState(false);

  useEffect(() => {
    const slot = slotRef.current;
    if (!slot) return;

    const measure = () => {
      // clientWidth is 0 when the label is in a hidden container (e.g. an
      // inactive tab kept mounted via display:none). Don't collapse in that
      // case, otherwise it gets stuck showing only the number when revealed.
      setHideName(slot.clientWidth > 0 && slot.clientWidth < MIN_NAME_WIDTH_PX);
      const text = textRef.current;
      if (text) {
        setIsTruncated(text.scrollWidth > text.clientWidth);
      }
    };

    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(slot);
    return () => observer.disconnect();
  }, [name, size]);

  // Re-measure truncation once the name is (re)mounted after a visibility flip.
  useEffect(() => {
    const text = textRef.current;
    if (text) {
      setIsTruncated(text.scrollWidth > text.clientWidth);
    }
  }, [hideName]);

  const content = (
    <Flex align="center" gap="1" minWidth="0">
      <VariationNumber number={number} />
      <Box ref={slotRef} minWidth="0" flexGrow="1" overflow="hidden">
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

  if (disableTooltip) return content;

  return (
    <Tooltip
      body={name}
      shouldDisplay={hideName || isTruncated}
      style={{ display: "block", minWidth: 0 }}
      tipPosition="top"
    >
      {content}
    </Tooltip>
  );
}

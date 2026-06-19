import { useEffect, useRef, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import Text from "@/ui/Text";
import Tooltip from "@/components/Tooltip/Tooltip";
import VariationNumber from "@/ui/VariationNumber";

export interface VariationLabelProps {
  number: number;
  name: string;
  size?: "small" | "medium" | "large";
}

// Below this available width (px) for the name, we drop the name entirely and
// show only the VariationNumber, relying on the tooltip to reveal the name.
const MIN_NAME_WIDTH_PX = 24;

export default function VariationLabel({
  number,
  name,
  size = "medium",
}: VariationLabelProps) {
  const slotRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [hideName, setHideName] = useState(false);
  const [isTruncated, setIsTruncated] = useState(false);

  useEffect(() => {
    const slot = slotRef.current;
    if (!slot) return;

    const measure = () => {
      setHideName(slot.clientWidth < MIN_NAME_WIDTH_PX);
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

  return (
    <Tooltip
      body={name}
      shouldDisplay={hideName || isTruncated}
      style={{ display: "block", minWidth: 0 }}
      tipPosition="top"
    >
      <Flex align="center" gap="1" minWidth="0">
        <VariationNumber number={number} />
        <Box ref={slotRef} minWidth="0" flexGrow="1" overflow="hidden">
          {!hideName ? (
            <Text
              ref={textRef}
              as="div"
              size={size}
              weight="medium"
              color="text-mid"
              truncate
            >
              {name}
            </Text>
          ) : null}
        </Box>
      </Flex>
    </Tooltip>
  );
}

import { Box, Flex, Heading, Text } from "@radix-ui/themes";
import React, { type ReactNode } from "react";
import { BigValueFormat } from "shared/validators";
import { useCurrency } from "@/hooks/useCurrency";
import { formatCurrency } from "@/services/metrics";

type Props = {
  value: number;
  format?: BigValueFormat;
  formatter?: (value: number) => string;
  label?: string;
  compareSlot?: ReactNode;
  /** Smaller heading for dense layouts (e.g. multi-metric grid). */
  compact?: boolean;
  /**
   * Scale the number/label/comparison to fill the surrounding container
   * (the number targets ~50% of the smaller container dimension, the
   * comparison ~25%). Only use inside a container with a determinate size.
   */
  fillContainer?: boolean;
};

// Font sizes for `fillContainer` mode, relative to the smaller container
// dimension (cqmin) per the design spec, but additionally capped by a
// fraction of the container width (cqw) so longer strings can't overflow a
// wide card, and clamped to a sane min/max.
const FILL_FONT_SIZE = {
  value: "clamp(2rem, min(50cqmin, 32cqw), 16rem)",
  label: "clamp(0.75rem, min(15cqmin, 9cqw), 4rem)",
  compare: "clamp(0.7rem, min(25cqmin, 9cqw), 5rem)",
} as const;

function formatValue(value: number, format: BigValueFormat, currency: string) {
  switch (format) {
    case "longNumber":
      return value.toFixed(2);
    case "currency":
      return formatCurrency(value, {
        currency,
        currencyDisplay: "narrowSymbol",
      });
    case "percentage":
      return new Intl.NumberFormat(undefined, { style: "percent" }).format(
        value,
      );
    case "accounting":
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        currencySign: "accounting",
        currencyDisplay: "narrowSymbol",
      }).format(value);
    default:
      return value.toFixed(0);
  }
}

export default function BigValueChart({
  value,
  label,
  format,
  formatter,
  compareSlot,
  compact = false,
  fillContainer = false,
}: Props) {
  const currency = useCurrency();
  if (value === undefined || value === null) {
    return <div style={{ textAlign: "center", color: "#888" }}>No data</div>;
  }

  const displayValue = formatter
    ? formatter(value)
    : formatValue(value, format ?? "longNumber", currency);

  const content = (
    <Flex
      align="center"
      justify="center"
      direction="column"
      height="100%"
      width="100%"
      pt="2"
      pb="2"
    >
      {fillContainer ? (
        <Heading
          as="h1"
          style={{
            fontSize: FILL_FONT_SIZE.value,
            lineHeight: 1.05,
            whiteSpace: "nowrap",
            maxWidth: "100%",
          }}
        >
          {displayValue}
        </Heading>
      ) : (
        <Heading as="h1" size={compact ? "7" : "9"}>
          {displayValue}
        </Heading>
      )}
      {label &&
        (fillContainer ? (
          <Text
            as="div"
            color="gray"
            style={{
              fontSize: FILL_FONT_SIZE.label,
              lineHeight: 1.2,
              whiteSpace: "nowrap",
              maxWidth: "100%",
            }}
          >
            {label}
          </Text>
        ) : (
          <Text as="div" size="3" color="gray">
            {label}
          </Text>
        ))}
      {fillContainer && compareSlot ? (
        <Box
          style={{
            fontSize: FILL_FONT_SIZE.compare,
            lineHeight: 1.2,
            maxWidth: "100%",
          }}
        >
          {compareSlot}
        </Box>
      ) : (
        compareSlot
      )}
    </Flex>
  );

  if (!fillContainer) return content;

  // Establish a query container so the cqmin/cqw units above resolve against
  // this card rather than the viewport.
  return (
    <div
      style={
        {
          width: "100%",
          height: "100%",
          containerType: "size",
        } as React.CSSProperties
      }
    >
      {content}
    </div>
  );
}

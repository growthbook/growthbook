import { Box, Flex, Heading } from "@radix-ui/themes";
import React, { type ReactNode } from "react";
import { BigValueFormat } from "shared/validators";
import { useCurrency } from "@/hooks/useCurrency";
import Text from "@/ui/Text";
import { formatCurrency } from "@/services/metrics";

type Props = {
  /** Null shows "No data". */
  value: number | null;
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

// Font sizes for `fillContainer` mode. The number scales to ~50% of the
// smaller container dimension (cqmin), capped by a fraction of the width
// (cqw) so it can't overflow a wide card. The label/comparison are captions:
// they scale gently with the width and stay small so they never wrap into or
// collide with the number.
const FILL_FONT_SIZE = {
  value: "clamp(2rem, min(40cqmin, 26cqw), 13rem)",
  label: "clamp(0.85rem, 5cqw, 1.5rem)",
  compare: "clamp(0.8rem, 4.5cqw, 1.25rem)",
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
  // No data keeps the card's layout, label and comparison; only the number
  // is replaced.
  const displayValue =
    value === null
      ? null
      : formatter
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
      {displayValue === null ? (
        <Text size="lg" color="text-low">
          No data
        </Text>
      ) : fillContainer ? (
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
          <Box
            style={{
              fontSize: FILL_FONT_SIZE.label,
              lineHeight: 1.2,
              width: "100%",
            }}
          >
            <Text
              as="div"
              size="inherit"
              color="text-mid"
              truncate
              align="center"
            >
              {label}
            </Text>
          </Box>
        ) : (
          <Text as="div" size="lg" color="text-mid">
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

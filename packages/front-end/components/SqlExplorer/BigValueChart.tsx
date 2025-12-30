import { Flex, Heading, Text } from "@radix-ui/themes";
import React from "react";
import { BigValueFormat } from "shared/validators";
import { useCurrency } from "@/hooks/useCurrency";
import { formatCurrency } from "@/services/metrics";

type Props = {
  value: number;
  format?: BigValueFormat;
  formatter?: (value: number) => string;
  label?: string;
};

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
}: Props) {
  const currency = useCurrency();
  if (value === undefined || value === null) {
    return <div style={{ textAlign: "center", color: "#888" }}>No data</div>;
  }
  return (
    <Flex
      align="center"
      justify="center"
      direction="column"
      height="100%"
      pt="2"
      pb="2"
    >
      <Heading as="h1" size="9">
        {formatter
          ? formatter(value)
          : formatValue(value, format ?? "longNumber", currency)}
      </Heading>
      {label && (
        <Text as="div" size="3" color="gray">
          {label}
        </Text>
      )}
    </Flex>
  );
}

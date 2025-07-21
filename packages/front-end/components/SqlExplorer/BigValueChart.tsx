import { Flex, Heading, Text } from "@radix-ui/themes";
import React from "react";

type Props = {
  value: number | string;
  label?: string;
};

export default function BigValueChart({ value, label }: Props) {
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
        {value}
      </Heading>
      {label && (
        <Text as="div" size="3" color="gray">
          {label}
        </Text>
      )}
    </Flex>
  );
}

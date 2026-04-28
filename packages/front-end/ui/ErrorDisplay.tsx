import type { ReactNode } from "react";
import { Box, Flex, Text } from "@radix-ui/themes";
import type { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { RadixStatusIcon } from "./HelperText";

function isEmptyError(error: string | ReactNode): boolean {
  if (error == null || error === false) return true;
  if (typeof error === "string") return !error.trim();
  return false;
}

export default function ErrorDisplay({
  error,
  maxLines = 4,
  ...containerProps
}: {
  error: string | ReactNode;
  maxLines?: number;
} & MarginProps) {
  if (isEmptyError(error)) return null;

  return (
    <Box
      style={{
        backgroundColor: "var(--red-a3)",
        borderRadius: "var(--radius-3)",
      }}
      role={"alert"}
      py="2"
      px="3"
      {...containerProps}
    >
      <Flex align="start" gap="2" style={{ width: "100%" }}>
        <Text color="red" style={{ marginTop: -2 }}>
          <RadixStatusIcon status={"error"} size={"md"} />
        </Text>
        <Box
          style={{
            flex: 1,
            maxHeight: 21 * maxLines,
            overflowY: "auto",
          }}
        >
          {typeof error === "string" ? (
            <Text size="2" color="red" style={{ whiteSpace: "pre-wrap" }}>
              {error}
            </Text>
          ) : (
            <Text size="2" color="red" as="div">
              {error}
            </Text>
          )}
        </Box>
      </Flex>
    </Box>
  );
}

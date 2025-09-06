import { Box, Flex, Text } from "@radix-ui/themes";
import { useState } from "react";
import { PiCaretDown, PiCaretRight } from "react-icons/pi";
import type { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import { RadixStatusIcon } from "./HelperText";

export default function ErrorDisplay({
  error,
  expandable = false,
  ...containerProps
}: {
  error: string;
  expandable?: boolean;
} & MarginProps) {
  // Split error into lines
  const errorLines = error.split("\n").filter((line) => line.trim() !== "");

  const [expanded, setExpanded] = useState(false);

  if (!errorLines.length) return null;

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
        <Text color="red">
          <RadixStatusIcon status={"error"} size={"sm"} />
        </Text>
        <div style={{ flex: 1, minWidth: 0 }}>
          {expanded || !expandable ? (
            <>
              <Text size="1" color="red">
                {errorLines[0]}
              </Text>
              {errorLines.length > 1 && (
                <pre>
                  <Text size="1" color="red">
                    {errorLines.slice(1).join("\n")}
                  </Text>
                </pre>
              )}
            </>
          ) : (
            <Text
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                display: "inline-block",
                whiteSpace: "nowrap",
                verticalAlign: "middle",
                cursor: "pointer",
                maxWidth: "100%",
              }}
              onClick={(e) => {
                e.preventDefault();
                setExpanded(true);
              }}
              size="1"
              color="red"
            >
              {errorLines[0]}
            </Text>
          )}
        </div>
        {expandable && (expanded || errorLines.length > 1) ? (
          <Text color="red">
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                setExpanded(!expanded);
              }}
              style={{
                color: "inherit",
                textDecoration: "none",
              }}
            >
              {expanded ? <PiCaretDown /> : <PiCaretRight />}
            </a>
          </Text>
        ) : null}
      </Flex>
    </Box>
  );
}

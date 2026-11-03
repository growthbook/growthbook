import { useState } from "react";
import { Box, Flex, Text } from "@radix-ui/themes";
import type { MarginProps } from "@radix-ui/themes/dist/esm/props/margin.props.js";
import MarkdownLinks from "@/components/Markdown/MarkdownLinks";
import Code from "@/components/SyntaxHighlighting/Code";
import Link from "@/ui/Link";
import { RadixStatusIcon } from "./HelperText";

export default function ErrorDisplay({
  error,
  details,
  maxLines = 4,
  ...containerProps
}: {
  error: string;
  // Technical context (stack traces, logs) shown behind a toggle.
  details?: string | null;
  maxLines?: number;
} & MarginProps) {
  // Keyed to the details text so a new error starts collapsed.
  const [openDetails, setOpenDetails] = useState<string | null>(null);
  const showDetails = !!details && openDetails === details;

  if (!error || !error.trim()) return null;

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
        <Box style={{ flex: 1, minWidth: 0 }}>
          <Box
            style={{
              maxHeight: 21 * maxLines,
              overflowY: "auto",
              whiteSpace: "pre-wrap",
            }}
          >
            <Text size="2" color="red">
              <MarkdownLinks text={error} />
            </Text>
          </Box>
          {details ? (
            <>
              <Link
                size="sm"
                color="red"
                onClick={() => setOpenDetails(showDetails ? null : details)}
              >
                {showDetails ? "Hide details" : "Show details"}
              </Link>
              {showDetails && (
                <Box mt="2">
                  <Code
                    code={details}
                    language="none"
                    filename="Details"
                    showLineNumbers={false}
                    maxHeight="240px"
                  />
                </Box>
              )}
            </>
          ) : null}
        </Box>
      </Flex>
    </Box>
  );
}

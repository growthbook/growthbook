import React from "react";
import { Box, Text, Flex, Badge } from "@radix-ui/themes";
import { isEmpty,
isEqual } from "lodash";
import { FaPlus, FaMinus, FaExchangeAlt } from "react-icons/fa";
import Code from "@/components/SyntaxHighlighting/Code";

interface ApprovalFlowDiffProps {
  currentState: Record<string, unknown>;
  proposedChanges: Record<string, unknown>;
}

const ApprovalFlowDiff: React.FC<ApprovalFlowDiffProps> = ({
  currentState,
  proposedChanges,
}) => {
  // Flatten nested objects into dot-notation paths
  const flattenObject = (
    obj: unknown,
    prefix = ""
  ): Record<string, unknown> => {
    if (obj === null || obj === undefined || typeof obj !== "object") {
      return { [prefix]: obj };
    }

    if (Array.isArray(obj)) {
      return { [prefix]: obj };
    }

    const flattened: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const newPrefix = prefix ? `${prefix}.${key}` : key;

      // If value is a simple object or primitive, add it directly
      if (
        value === null ||
        value === undefined ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        Object.keys(value).length === 0
      ) {
        flattened[newPrefix] = value;
      } else {
        Object.assign(flattened, flattenObject(value, newPrefix));
      }
    }
    return flattened;
  };

  // Only flatten the fields that are in proposedChanges
  const flatProposed = flattenObject(proposedChanges);
  // For each proposed field, get the corresponding current value
  const flatCurrent: Record<string, unknown> = {};
  for (const key of Object.keys(flatProposed)) {
    // Navigate to the nested value in currentState
    const keys = key.split(".");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let value: any = currentState;
    for (const k of keys) {
      value = value?.[k];
      if (value === undefined) break;
    }
    flatCurrent[key] = value;
  }

  // Only show fields that actually have changes
  const changedFields = Object.keys(flatProposed).filter(
    (key) => !isEqual(flatCurrent[key], flatProposed[key])
  );

  if (changedFields.length === 0) {
    return (
      <Box
        p="4"
        style={{
          backgroundColor: "var(--gray-2)",
          borderRadius: "var(--radius-2)",
          textAlign: "center",
        }}
      >
        <Text size="2" color="gray">
          No changes to display.
        </Text>
      </Box>
    );
  }

  const formatValue = (value: unknown): string => {
    if (value === null || value === undefined) {
      return "null";
    }
    if (typeof value === "boolean") {
      return value ? "true" : "false";
    }
    if (Array.isArray(value)) {
      return JSON.stringify(value, null, 2);
    }
    if (typeof value === "object") {
      return JSON.stringify(value, null, 2);
    }
    return String(value);
  };

  const isAddition = (oldVal: unknown, newVal: unknown) => isEmpty(oldVal) && !isEmpty(newVal);
  const isDeletion = (oldVal: unknown, newVal: unknown) =>
    !isEmpty(oldVal) && isEmpty(newVal);
  const renderFieldDiff = (field: string) => {
    const oldValue = flatCurrent[field];
    const newValue = flatProposed[field];
    const isLongValue =
      formatValue(oldValue).length > 80 || formatValue(newValue).length > 80;
    const isAdd = isAddition(oldValue, newValue);
    const isDel = isDeletion(oldValue, newValue);

    return (
      <Box
        key={field}
        p="3"
        mb="2"
        style={{
          backgroundColor: "var(--gray-2)",
          borderRadius: "var(--radius-2)",
          border: "1px solid var(--gray-4)",
        }}
      >
            <Text weight="medium" size="2">
              {field}
            </Text>
        {isLongValue ? (
          <Flex gap="3" direction={{ initial: "column", md: "row" }}>
            {/* Old value */}
            <Box style={{ flex: 1 }}>
              <Flex align="center" gap="1" mb="1">
                <Box
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: "50%",
                    backgroundColor: "var(--red-4)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <FaMinus size={8} style={{ color: "var(--red-11)" }} />
                </Box>
                <Text size="1" color="gray">
                  Current
                </Text>
              </Flex>
              <Box
                p="2"
                style={{
                  backgroundColor: "var(--red-2)",
                  border: "1px solid var(--red-5)",
                  borderRadius: "var(--radius-2)",
                  overflow: "auto",
                }}
              >
                <Code language="json" code={formatValue(oldValue)} />
              </Box>
            </Box>

            {/* New value */}
            <Box style={{ flex: 1 }}>
              <Flex align="center" gap="1" mb="1">
                <Box
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: "50%",
                    backgroundColor: "var(--green-4)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <FaPlus size={8} style={{ color: "var(--green-11)" }} />
                </Box>
                <Text size="1" color="gray">
                  Proposed
                </Text>
              </Flex>
              <Box
                p="2"
                style={{
                  backgroundColor: "var(--green-2)",
                  border: "1px solid var(--green-5)",
                  borderRadius: "var(--radius-2)",
                  overflow: "auto",
                }}
              >
                <Code language="json" code={formatValue(newValue)} />
              </Box>
            </Box>
          </Flex>
        ) : (
          <Flex align="center" gap="2" wrap="wrap">
            <Box
              px="2"
              py="1"
              style={{
                backgroundColor: isAdd ? "var(--gray-3)" : "var(--red-3)",
                borderRadius: "var(--radius-1)",
                opacity: isDel ? 1 : 0.7,
              }}
            >
              <code style={{ fontSize: 12, color: isAdd ? "var(--gray-11)" : "var(--red-11)" }}>
                {isAdd ? "None" : formatValue(oldValue)}
              </code>
            </Box>
            {!isDel && (
              <>
                <Text color="gray" size="1">
                  →
                </Text>
                <Box
                  px="2"
                  py="1"
                  style={{
                    backgroundColor: isDel ? "var(--gray-3)" : "var(--green-3)",
                    borderRadius: "var(--radius-1)",
                  }}
                >
                  <code style={{ fontSize: 12, color: isDel ? "var(--gray-11)" : "var(--green-11)" }}>
                    {isDel ? "None" : formatValue(newValue)}
                  </code>
                </Box>
              </>
            )}
          </Flex>
        )}
      </Box>
    );
  };

  return (
    <Box>
      <Flex align="center" gap="2" mb="3">
        <Text size="2" color="gray">
          {changedFields.length} field{changedFields.length !== 1 ? "s" : ""}{" "}
          changed
        </Text>
      </Flex>
      {changedFields.map(renderFieldDiff)}
    </Box>
  );
};

export default ApprovalFlowDiff;

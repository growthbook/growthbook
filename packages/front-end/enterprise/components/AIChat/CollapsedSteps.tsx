import React, { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiCaretRight, PiCheckCircle } from "react-icons/pi";
import Text from "@/ui/Text";
import { ToolStatusIcon } from "./AIChatPrimitives";
import styles from "./AIChatPrimitives.module.scss";

export interface CollapsedStepItem {
  key: string;
  kind: "tool" | "text";
  label: string;
  status?: "done" | "error" | "running";
  /** Expandable details rendered below the label (e.g. ToolUsageDetails). */
  details?: React.ReactNode;
}

interface CollapsedStepsProps {
  count: number;
  items: CollapsedStepItem[];
  defaultExpanded?: boolean;
  onToggle?: (expanded: boolean) => void;
}

export default function CollapsedSteps({
  count,
  items,
  defaultExpanded = false,
  onToggle,
}: CollapsedStepsProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  if (count === 0) return null;

  return (
    <Box>
      <button
        className={styles.collapsedToggle}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "0 0 4px 0",
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "var(--gray-a11)",
        }}
        onClick={() => {
          setExpanded((v) => {
            onToggle?.(!v);
            return !v;
          });
        }}
      >
        <span
          style={{
            display: "inline-flex",
            flexShrink: 0,
            transition: "transform 150ms ease",
            transform: expanded ? "rotate(90deg)" : undefined,
          }}
        >
          <PiCaretRight size={10} />
        </span>
        <PiCheckCircle size={12} color="var(--green-9)" />
        <Text size="small" color="text-low">
          Completed {count} {count === 1 ? "step" : "steps"}
        </Text>
      </button>

      {expanded && (
        <Box style={{ padding: "4px 0 4px 4px" }}>
          {items.map((item, idx) => (
            <Flex key={item.key} gap="2">
              <Flex
                direction="column"
                align="center"
                style={{ width: 14, paddingTop: 3, flexShrink: 0 }}
              >
                {item.kind === "tool" ? (
                  <ToolStatusIcon status={item.status ?? "done"} />
                ) : (
                  <span
                    style={{
                      width: 5,
                      height: 5,
                      borderRadius: "50%",
                      background: "var(--gray-a8)",
                      flexShrink: 0,
                      marginTop: 1,
                    }}
                  />
                )}
                {idx < items.length - 1 && (
                  <div
                    style={{
                      flex: 1,
                      width: 1,
                      minHeight: 6,
                      background: "var(--gray-a5)",
                      margin: "2px 0",
                    }}
                  />
                )}
              </Flex>
              <div
                className={styles.collapsedContent}
                style={{ flex: 1, minWidth: 0, paddingBottom: 4 }}
              >
                {item.kind === "tool" ? (
                  <Text size="small" color="text-low">
                    {item.label}
                  </Text>
                ) : (
                  <div
                    style={{
                      fontSize: "var(--font-size-1)",
                      lineHeight: 1.5,
                      color: "var(--gray-a11)",
                    }}
                  >
                    {item.label}
                  </div>
                )}
                {item.details}
              </div>
            </Flex>
          ))}
        </Box>
      )}
    </Box>
  );
}

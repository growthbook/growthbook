import React, { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiCaretRight } from "react-icons/pi";
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
  active?: {
    key: string;
    label: string;
    status: "done" | "error" | "running";
  } | null;
  defaultExpanded?: boolean;
  onToggle?: (expanded: boolean) => void;
}

export default function CollapsedSteps({
  count,
  items,
  active = null,
  defaultExpanded = false,
  onToggle,
}: CollapsedStepsProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  if (count === 0 && !active) return null;

  return (
    <Box className={styles.agentActivity}>
      {count > 0 && (
        <button
          type="button"
          className={styles.collapsedToggle}
          aria-expanded={expanded}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: 0,
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
            className={styles.activityCaret}
            style={{
              transform: expanded ? "rotate(90deg)" : undefined,
            }}
          >
            <PiCaretRight size={10} />
          </span>
          <Text size="sm" color="text-low">
            {count} {count === 1 ? "step" : "steps"} completed
          </Text>
          <span className={styles.activityViewLabel}>
            {expanded ? "Hide" : "View"}
          </span>
        </button>
      )}

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
                  <Text size="sm" color="text-low">
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

      {active && (
        <Flex
          align="center"
          gap="2"
          className={styles.activeStatus}
          aria-live="polite"
        >
          <ToolStatusIcon status={active.status} />
          <span
            key={`${active.key}-${active.label}`}
            className={styles.statusText}
          >
            <Text size="sm" color="text-low">
              {active.label}
            </Text>
          </span>
        </Flex>
      )}
    </Box>
  );
}

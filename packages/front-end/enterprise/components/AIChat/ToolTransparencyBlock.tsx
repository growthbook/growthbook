import React, { useState } from "react";
import { Box } from "@radix-ui/themes";
import Text from "@/ui/Text";
import styles from "./ToolTransparencyBlock.module.scss";

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Format persisted tool result (JSON string) or live stream output for display. */
function formatToolOutputForPre(toolOutput: unknown): string {
  if (toolOutput === undefined || toolOutput === null) {
    return "";
  }
  if (typeof toolOutput === "string") {
    try {
      const parsed = JSON.parse(toolOutput) as unknown;
      // Tools that return pre-formatted JSON strings are stored with an extra
      // JSON.stringify pass (double-encoded). Detect this by checking whether
      // the first parse produced a string, then try to parse the inner value.
      if (typeof parsed === "string") {
        try {
          return prettyJson(JSON.parse(parsed) as unknown);
        } catch {
          return parsed;
        }
      }
      return prettyJson(parsed);
    } catch {
      return toolOutput;
    }
  }
  return prettyJson(toolOutput);
}

export interface ToolTransparencyBlockProps {
  toolInput?: Record<string, unknown>;
  argsTextPreview?: string;
  toolOutput?: unknown;
  /** When true, sits flush inside a parent card (e.g. under a chart). */
  embedded?: boolean;
  /** Collapsible summary label (default "Tool details"). */
  summaryLabel?: string;
  /**
   * Stable identifier (tool call ID) used to persist the open/closed state
   * across remounts. When provided, pairs with `openStateRef` to survive the
   * activeTurnItems → messages transition at turn end.
   */
  toolCallId?: string;
  /**
   * Ref holding a record of toolCallId → open state. When the component
   * remounts it reads from this ref so the panel stays open if the user had
   * expanded it during the live turn.
   */
  openStateRef?: React.MutableRefObject<Record<string, boolean>>;
}

/**
 * Collapsible JSON view for tool arguments / streaming args / outputs.
 */
export default function ToolTransparencyBlock({
  toolInput,
  argsTextPreview,
  toolOutput,
  embedded = false,
  summaryLabel = "Tool details",
  toolCallId,
  openStateRef,
}: ToolTransparencyBlockProps) {
  const hasInputObj = toolInput && Object.keys(toolInput).length > 0;
  const hasArgsText = argsTextPreview && argsTextPreview.length > 0;
  const hasOutput = toolOutput !== undefined;

  const [open, setOpen] = useState<boolean>(() => {
    if (toolCallId && openStateRef) {
      return openStateRef.current[toolCallId] ?? false;
    }
    return false;
  });

  const handleToggle = (e: React.SyntheticEvent<HTMLDetailsElement>) => {
    const newOpen = e.currentTarget.open;
    setOpen(newOpen);
    if (toolCallId && openStateRef) {
      openStateRef.current[toolCallId] = newOpen;
    }
  };

  if (!hasInputObj && !hasArgsText && !hasOutput) return null;

  const outputTruncated =
    toolOutput &&
    typeof toolOutput === "object" &&
    !Array.isArray(toolOutput) &&
    (toolOutput as { _truncated?: boolean })._truncated === true;

  return (
    <Box
      mt={embedded ? "0" : "2"}
      className={embedded ? styles.embedded : styles.wrap}
    >
      <details
        className={styles.details}
        open={open}
        onToggle={handleToggle}
      >
        <summary className={styles.summary}>
          <Text size="small" color="text-low">
            {summaryLabel}
          </Text>
        </summary>
        {outputTruncated ? (
          <p className={styles.truncationWarning}>
            Payload exceeded the stream size limit; shown value may be
            incomplete.
          </p>
        ) : null}
        {hasArgsText ? (
          <pre className={styles.pre}>{argsTextPreview}</pre>
        ) : null}
        {hasInputObj ? (
          <>
            <Box mb="1">
              <Text size="small" color="text-low" weight="medium">
                Input
              </Text>
            </Box>
            <pre className={styles.pre}>{prettyJson(toolInput)}</pre>
          </>
        ) : null}
        {hasOutput ? (
          <>
            <Box mb="1">
              <Text size="small" color="text-low" weight="medium">
                Output
              </Text>
            </Box>
            <pre className={styles.pre}>
              {formatToolOutputForPre(toolOutput)}
            </pre>
          </>
        ) : null}
      </details>
    </Box>
  );
}

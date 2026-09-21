import { ReactNode } from "react";
import { Box } from "@radix-ui/themes";
import Tooltip from "@/ui/Tooltip";
import Text from "@/ui/Text";
import HelperText from "@/ui/HelperText";

/**
 * Marks a readout as describing an unpublished draft rather than what is live.
 * Shared so every surface on the overview uses the same mark.
 */
export default function UnpublishedDot({
  tooltip,
  note,
}: {
  tooltip?: ReactNode;
  /** Rendered under the tooltip — e.g. other drafts this readout doesn't show. */
  note?: string;
}) {
  const dot = (
    <Box
      style={{
        flexShrink: 0,
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: "var(--amber-9)",
      }}
    />
  );
  // A label that already says "unpublished" doesn't need the tooltip repeating it.
  if (!tooltip && !note) return dot;

  return (
    <Tooltip
      content={
        <Box>
          {tooltip ? <Text size="sm">{tooltip}</Text> : null}
          {note ? (
            <HelperText status="info" size="sm" mt="1">
              {note}
            </HelperText>
          ) : null}
        </Box>
      }
    >
      {dot}
    </Tooltip>
  );
}

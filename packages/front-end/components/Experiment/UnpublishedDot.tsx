import { Box } from "@radix-ui/themes";
import Tooltip from "@/ui/Tooltip";

/**
 * Marks a readout as describing an unpublished draft rather than what is live.
 * Shared so every surface on the overview uses the same mark.
 */
export default function UnpublishedDot({ tooltip }: { tooltip?: string }) {
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
  return tooltip ? <Tooltip content={tooltip}>{dot}</Tooltip> : dot;
}

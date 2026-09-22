import { ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiInfo } from "react-icons/pi";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";

/** Width of the label column. Every setup field shares it, so they line up. */
export const LABEL_WIDTH = "180px";

/** Below this a control has no usable room, and the row stacks instead. */
const MIN_FIELD_WIDTH = "260px";

/** Half the difference between a control's height and its own text. */
const LABEL_OFFSET: Record<LabelSize, string> = { md: "10px", lg: "6px" };

type LabelSize = "md" | "lg";

/** Whether the row holds a control, which is taller than its own text, or text. */
type RowContent = "control" | "text";

/**
 * One field on the setup tab: its name on the left, the control on the right.
 * Anything explaining the field belongs in `tooltip`, not under the label.
 */
export default function SetupFieldRow({
  label,
  labelSize = "md",
  tooltip,
  content = "control",
  fieldMaxWidth,
  children,
}: {
  label: string;
  /** `lg` for a field whose label doubles as the section's title. */
  labelSize?: LabelSize;
  tooltip?: string;
  /** `text` for a row that only reads a value back, which needs no offset. */
  content?: RowContent;
  /**
   * The width a control keeps, for one that has no business filling the row.
   * It is also the point the row wraps at, in place of the usual threshold.
   */
  fieldMaxWidth?: string;
  children: ReactNode;
}) {
  return (
    // Wraps rather than squeezing: below the width the field needs, the label
    // takes a row of its own. Driven by the row's own width, not the window's.
    <Flex align="start" gap="4" py="2" wrap="wrap">
      <Box
        flexShrink="0"
        width={LABEL_WIDTH}
        // Nudged down so the label reads level with the control beside it,
        // which centres its own text inside a taller box.
        style={{
          paddingTop: content === "control" ? LABEL_OFFSET[labelSize] : "0",
        }}
      >
        <Flex align="center" gap="1">
          <Text
            as="label"
            size={labelSize}
            weight="medium"
            color="text-high"
            mb="0"
          >
            {label}
          </Text>
          {tooltip ? (
            <Tooltip content={<Text align="left">{tooltip}</Text>}>
              <span style={{ display: "flex", color: "var(--color-text-mid)" }}>
                <PiInfo />
              </span>
            </Tooltip>
          ) : null}
        </Flex>
      </Box>
      <Box
        flexGrow="1"
        style={{
          minWidth: `min(100%, ${fieldMaxWidth ?? MIN_FIELD_WIDTH})`,
          maxWidth: fieldMaxWidth,
        }}
      >
        {children}
      </Box>
    </Flex>
  );
}

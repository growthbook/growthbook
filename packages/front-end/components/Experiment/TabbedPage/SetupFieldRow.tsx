import { ReactNode } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { PiInfo } from "react-icons/pi";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";

// Shared by every setup field so their controls line up.
export const LABEL_WIDTH = "180px";

const MIN_FIELD_WIDTH = "260px";

// Nudges the label level with the text a taller control centres.
const LABEL_OFFSET: Record<LabelSize, string> = { md: "10px", lg: "6px" };

type LabelSize = "md" | "lg";

/** A setup field: its label on the left, the control on the right. */
export default function SetupFieldRow({
  id,
  label,
  labelSize = "md",
  tooltip,
  content = "control",
  labelAlign = "top",
  children,
}: {
  /** For pointing at the field from elsewhere on the page. */
  id?: string;
  label: string;
  /** `lg` for a field whose label doubles as the section's title. */
  labelSize?: LabelSize;
  tooltip?: string;
  /** `text` for a row that only reads a value back, which needs no offset. */
  content?: "control" | "text";
  /** `center` for a row whose control is a single line, such as a select. */
  labelAlign?: "top" | "center";
  children: ReactNode;
}) {
  return (
    // A narrow row wraps, putting the label on its own line.
    <Flex
      id={id}
      align={labelAlign === "center" ? "center" : "start"}
      gap="4"
      py="2"
      wrap="wrap"
    >
      <Box
        flexShrink="0"
        width={LABEL_WIDTH}
        style={{
          paddingTop:
            content === "control" && labelAlign === "top"
              ? LABEL_OFFSET[labelSize]
              : "0",
        }}
      >
        <Flex align="center" gap="1">
          <Text
            as="label"
            size={labelSize}
            weight={labelSize === "lg" ? "semibold" : "medium"}
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
      <Box flexGrow="1" style={{ minWidth: `min(100%, ${MIN_FIELD_WIDTH})` }}>
        {children}
      </Box>
    </Flex>
  );
}

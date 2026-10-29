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
// Text inside a padded panel starts the panel's padding down.
const PANEL_PADDING = "var(--space-4)";

type LabelSize = "md" | "lg";

export default function SetupFieldRow({
  id,
  label,
  labelSize = "md",
  tooltip,
  content = "control",
  labelAlign = "top",
  stacked = false,
  children,
}: {
  /** For pointing at the field from elsewhere on the page. */
  id?: string;
  label: string;
  /** `lg` for a field whose label doubles as the section's title. */
  labelSize?: LabelSize;
  tooltip?: string;
  /**
   * `text` for a row that only reads a value back, which needs no offset;
   * `panel` for values inside a padded panel.
   */
  content?: "control" | "text" | "panel";
  /** `center` for a row whose control is a single line, such as a select. */
  labelAlign?: "top" | "center";
  /** Label above, for a control that needs the row's full width. */
  stacked?: boolean;
  children: ReactNode;
}) {
  return (
    // A narrow row wraps, putting the label on its own line.
    <Flex
      id={id}
      // Text shares the label's baseline, whatever their sizes.
      align={
        labelAlign === "center"
          ? "center"
          : content === "text"
            ? "baseline"
            : "start"
      }
      gap={stacked ? "2" : "4"}
      py="2"
      wrap="wrap"
    >
      <Box
        flexShrink="0"
        width={stacked ? "100%" : LABEL_WIDTH}
        style={{
          paddingTop:
            stacked || content === "text" || labelAlign === "center"
              ? "0"
              : content === "panel"
                ? PANEL_PADDING
                : LABEL_OFFSET[labelSize],
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
            <InfoTip content={<Text align="left">{tooltip}</Text>} />
          ) : null}
        </Flex>
      </Box>
      <Box
        flexGrow="1"
        flexBasis="0"
        style={{ minWidth: `min(100%, ${MIN_FIELD_WIDTH})` }}
      >
        {children}
      </Box>
    </Flex>
  );
}

export function InfoTip({ content }: { content: ReactNode }) {
  return (
    <Tooltip content={content}>
      {/* Focusable, so the tip opens from the keyboard too. */}
      <span
        tabIndex={0}
        role="button"
        aria-label="More information"
        style={{
          display: "inline-flex",
          verticalAlign: "middle",
          color: "var(--color-text-mid)",
        }}
      >
        <PiInfo />
      </span>
    </Tooltip>
  );
}

/**
 * Rows edited together, on a gray ground that reaches past them so their
 * labels stay in line with the rows around it.
 */
export function SetupFieldGroup({
  inset = false,
  children,
}: {
  /** Inside its container, for rows with none around them to line up with. */
  inset?: boolean;
  children: ReactNode;
}) {
  return (
    <Box
      mx={inset ? "0" : "-4"}
      px="4"
      py="2"
      my="2"
      style={{
        backgroundColor: "var(--gray-a2)",
        borderRadius: "var(--radius-3)",
      }}
    >
      {children}
    </Box>
  );
}

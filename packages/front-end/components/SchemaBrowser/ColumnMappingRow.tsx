import { useState } from "react";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import {
  PiArrowsSplitBold,
  PiClockBold,
  PiFlaskBold,
  PiPlus,
  PiUserBold,
  PiX,
} from "react-icons/pi";
import { DetectedColumn } from "shared/types/fact-table";
import Avatar from "@/ui/Avatar";
import Button from "@/ui/Button";
import Tooltip from "@/ui/Tooltip";
import { Select, SelectItem } from "@/ui/Select";
import { TableCell, TableRow } from "@/ui/Table";
import Text from "@/ui/Text";

export const validColumn = (options: DetectedColumn[], column: string) =>
  options.some((c) => c.column === column) ? column : "";

// Identifier and timestamp match the badges on the Fact Table column list.
const KIND_BADGES = {
  experiment: {
    tooltip: "Experiment ID",
    icon: <PiFlaskBold size={14} />,
  },
  variation: {
    tooltip: "Variation ID",
    icon: <PiArrowsSplitBold size={14} />,
  },
  identifier: {
    tooltip: "Unit identifier type",
    icon: <PiUserBold size={14} />,
  },
  timestamp: { tooltip: "Main date field", icon: <PiClockBold size={14} /> },
};

export default function ColumnMappingRow({
  label,
  kind,
  value,
  options,
  setValue,
  onRemove,
}: {
  label: string;
  kind?: keyof typeof KIND_BADGES;
  value: string;
  options: DetectedColumn[];
  setValue: (column: string) => void;
  onRemove?: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const selected = validColumn(options, value);

  return (
    <TableRow align="center">
      <TableCell style={{ width: "50%" }}>
        <Flex align="center" gap="2">
          {kind ? (
            <Tooltip content={KIND_BADGES[kind].tooltip} side="left">
              {/* Avatar forwards trigger props to its hidden image, so the
                  wrapper takes the tooltip's hover handlers instead. */}
              <Flex as="span" flexShrink="0">
                <Avatar size="sm" color="violet" variant="soft" radius="small">
                  {KIND_BADGES[kind].icon}
                </Avatar>
              </Flex>
            </Tooltip>
          ) : (
            // Keeps labels aligned with the badged rows.
            <Box width="var(--space-5)" flexShrink="0" />
          )}
          <Text size="sm" weight="medium">
            {label}
          </Text>
        </Flex>
      </TableCell>
      {selected || adding || !onRemove ? (
        <>
          <TableCell>
            <Select
              size="sm"
              mb="0"
              autoFocus={adding}
              value={selected || undefined}
              setValue={setValue}
              placeholder="Select a column..."
            >
              {options.map((c) => (
                <SelectItem key={c.column} value={c.column}>
                  {c.column}
                </SelectItem>
              ))}
            </Select>
          </TableCell>
          <TableCell style={{ width: "40px" }}>
            {onRemove ? (
              <Flex align="center">
                <IconButton
                  variant="ghost"
                  color="gray"
                  size="1"
                  onClick={() => {
                    setAdding(false);
                    onRemove();
                  }}
                  aria-label={`Remove ${label}`}
                >
                  <PiX />
                </IconButton>
              </Flex>
            ) : null}
          </TableCell>
        </>
      ) : (
        <TableCell colSpan={2}>
          <Button
            variant="ghost"
            size="sm"
            icon={<PiPlus />}
            onClick={() => setAdding(true)}
          >
            Add column
          </Button>
        </TableCell>
      )}
    </TableRow>
  );
}

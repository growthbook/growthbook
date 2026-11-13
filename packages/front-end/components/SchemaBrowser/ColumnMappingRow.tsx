import { ReactNode, useState } from "react";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import {
  PiArrowsSplitBold,
  PiCalendarBold,
  PiClockBold,
  PiColumnsBold,
  PiFlagBold,
  PiFlaskBold,
  PiFunnelBold,
  PiPlus,
  PiTagBold,
  PiUserBold,
  PiX,
} from "react-icons/pi";
import { DetectedColumn } from "shared/types/fact-table";
import Button from "@/ui/Button";
import HelperText from "@/ui/HelperText";
import Link from "@/ui/Link";
import TextField from "@/ui/TextField";
import Tooltip from "@/ui/Tooltip";
import { Select, SelectItem } from "@/ui/Select";
import { TableCell, TableRow } from "@/ui/Table";
import Text from "@/ui/Text";

// Select value for the "type a value" option; never a real column name
const CUSTOM_VALUE = "__custom__";

export const validColumn = (options: DetectedColumn[], column: string) =>
  options.some((c) => c.column === column) ? column : "";

const KIND_ICONS = {
  experiment: {
    tooltip: "The experiment's tracking key",
    icon: <PiFlaskBold />,
  },
  variation: {
    tooltip: "Which variation the unit saw",
    icon: <PiArrowsSplitBold />,
  },
  identifier: {
    tooltip: "Unit identifier type",
    icon: <PiUserBold />,
  },
  timestamp: { tooltip: "Main date field", icon: <PiClockBold /> },
  event: {
    tooltip: "Event name filter",
    icon: <PiFunnelBold />,
  },
  partition: {
    tooltip: "Date partition filter",
    icon: <PiCalendarBold />,
  },
  columns: {
    tooltip: "Other columns to include",
    icon: <PiColumnsBold />,
  },
  feature: {
    tooltip: "The Feature Flag's key",
    icon: <PiFlagBold />,
  },
  detail: {
    tooltip: "Extra detail about each evaluation",
    icon: <PiTagBold />,
  },
};

export function ColumnKindIcon({
  kind,
  tooltip,
}: {
  kind: keyof typeof KIND_ICONS;
  tooltip?: string;
}) {
  return (
    <Tooltip content={tooltip ?? KIND_ICONS[kind].tooltip} side="left">
      <Flex as="span" flexShrink="0">
        {KIND_ICONS[kind].icon}
      </Flex>
    </Tooltip>
  );
}

export default function ColumnMappingRow({
  label,
  kind,
  tooltip,
  value,
  options,
  setValue,
  onRemove,
  append,
  customValue,
  error,
}: {
  label: string;
  kind: keyof typeof KIND_ICONS;
  // Replaces the kind's tooltip where the role means something more specific
  tooltip?: string;
  value: string;
  options: DetectedColumn[];
  setValue: (column: string) => void;
  onRemove?: () => void;
  // Shown next to the select once a column is picked
  append?: ReactNode;
  /** Lets the user type a value not in the options, like a JSON field path. */
  customValue?: { label: string; placeholder: string };
  /** Shown under the column, e.g. for a typed value that can't be used. */
  error?: string | null;
}) {
  const [adding, setAdding] = useState(false);
  const [typing, setTyping] = useState(false);
  // A value being typed is only flagged once the user leaves the field
  const [touched, setTouched] = useState(false);
  const selected = validColumn(options, value);
  // A saved value that isn't an option was typed in
  const custom = !!customValue && (typing || (!!value && !selected));

  return (
    <TableRow align="center">
      <TableCell style={{ width: "40%" }}>
        <Flex align="center" gap="2">
          <ColumnKindIcon kind={kind} tooltip={tooltip} />
          <Text size="sm" weight="medium">
            {label}
          </Text>
        </Flex>
      </TableCell>
      {selected || custom || adding || !onRemove || error ? (
        <>
          <TableCell>
            <Flex align="center" gap="2">
              <Box flexGrow="1" minWidth="0">
                {custom ? (
                  <TextField
                    size="sm"
                    aria-label={label}
                    autoFocus={typing}
                    placeholder={customValue.placeholder}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onBlur={() => setTouched(true)}
                    error={(!typing || touched) && error ? error : undefined}
                    append={
                      <Link
                        onClick={() => {
                          setTyping(false);
                          setValue("");
                        }}
                      >
                        Select a column
                      </Link>
                    }
                  />
                ) : (
                  <Select
                    size="sm"
                    mb="0"
                    aria-label={label}
                    autoFocus={adding}
                    value={selected || undefined}
                    setValue={(v) => {
                      if (v === CUSTOM_VALUE) {
                        setTyping(true);
                        setValue("");
                      } else {
                        setValue(v);
                      }
                    }}
                    placeholder="Select a column..."
                  >
                    {options.map((c) => (
                      <SelectItem key={c.column} value={c.column}>
                        {c.column}
                      </SelectItem>
                    ))}
                    {customValue ? (
                      <SelectItem value={CUSTOM_VALUE}>
                        {customValue.label}
                      </SelectItem>
                    ) : null}
                  </Select>
                )}
                {error && !custom ? (
                  <HelperText status="error" mt="1">
                    {error}
                  </HelperText>
                ) : null}
              </Box>
              {selected ? append : null}
            </Flex>
          </TableCell>
          <TableCell style={{ width: "40px" }}>
            {onRemove ? (
              <Flex align="center">
                <IconButton
                  type="button"
                  variant="ghost"
                  color="gray"
                  size="1"
                  onClick={() => {
                    setAdding(false);
                    setTyping(false);
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
            aria-label={`Add ${label} column`}
          >
            Add column
          </Button>
        </TableCell>
      )}
    </TableRow>
  );
}

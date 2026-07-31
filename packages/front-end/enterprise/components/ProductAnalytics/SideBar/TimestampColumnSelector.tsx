import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import { PiCheck } from "react-icons/pi";
import Button from "@/ui/Button";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import Text from "@/ui/Text";
import Tooltip from "@/components/Tooltip/Tooltip";

export default function TimestampColumnSelector({
  timestampColumn,
  columns,
  onChange,
  allowNone = false,
  selectTooltip,
}: {
  timestampColumn: string | null;
  columns: string[];
  onChange: (column: string | null) => void;
  allowNone?: boolean;
  selectTooltip?: string;
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdown = (
    <DropdownMenu
      open={dropdownOpen}
      onOpenChange={setDropdownOpen}
      disabled={!columns.length}
      trigger={
        <Button size="xs" variant="ghost">
          <Text weight="semibold" size="small">
            {timestampColumn ? "Change" : "Select"}
          </Text>
        </Button>
      }
    >
      {allowNone ? (
        <DropdownMenuItem
          onClick={() => {
            onChange(null);
            setDropdownOpen(false);
          }}
        >
          <Flex align="center" justify="between" gap="2">
            <Flex align="center" width="20px">
              {timestampColumn === null ? <PiCheck size={16} /> : null}
            </Flex>
            None
          </Flex>
        </DropdownMenuItem>
      ) : null}
      {columns.map((column) => (
        <DropdownMenuItem
          key={column}
          onClick={() => {
            onChange(column);
            setDropdownOpen(false);
          }}
        >
          <Flex align="center" justify="between" gap="2">
            <Flex align="center" width="20px">
              {timestampColumn === column ? <PiCheck size={16} /> : null}
            </Flex>
            {column}
          </Flex>
        </DropdownMenuItem>
      ))}
    </DropdownMenu>
  );

  return (
    <Flex direction="column" gap="2" width="100%">
      <Text weight="medium">Timestamp column</Text>
      <Flex justify="between" align="center">
        <Text color="text-low">{timestampColumn ?? "Not set"}</Text>
        {selectTooltip ? (
          <Tooltip body={selectTooltip} usePortal>
            {dropdown}
          </Tooltip>
        ) : (
          dropdown
        )}
      </Flex>
    </Flex>
  );
}

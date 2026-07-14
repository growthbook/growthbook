import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import { PiCheck } from "react-icons/pi";
import Button from "@/ui/Button";
import { DropdownMenu, DropdownMenuItem } from "@/ui/DropdownMenu";
import Text from "@/ui/Text";

export default function TimestampColumnSelector({
  timestampColumn,
  columns,
  onChange,
  helpText,
}: {
  timestampColumn: string;
  columns: string[];
  onChange: (column: string) => void;
  helpText?: string;
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false);

  return (
    <Flex direction="column" gap="2" width="100%">
      <Text weight="medium">Timestamp Column</Text>
      <Flex justify="between" align="center">
        <Text color="text-low">
          {timestampColumn || "Select timestamp column..."}
        </Text>
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
      </Flex>
      {helpText ? (
        <Text size="small" color="text-low">
          {helpText}
        </Text>
      ) : null}
    </Flex>
  );
}

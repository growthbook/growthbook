import { useState } from "react";
import { Flex, IconButton } from "@radix-ui/themes";
import { PiPlus, PiX } from "react-icons/pi";
import { DetectedColumn } from "shared/types/fact-table";
import Button from "@/ui/Button";
import { Select, SelectItem } from "@/ui/Select";
import { TableCell, TableRow } from "@/ui/Table";
import Text from "@/ui/Text";

export const validColumn = (options: DetectedColumn[], column: string) =>
  options.some((c) => c.column === column) ? column : "";

export default function ColumnMappingRow({
  label,
  value,
  options,
  setValue,
  onRemove,
}: {
  label: string;
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
        <Text size="sm" weight="medium">
          {label}
        </Text>
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

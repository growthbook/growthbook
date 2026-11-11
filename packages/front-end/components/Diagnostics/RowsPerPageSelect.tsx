import { Flex } from "@radix-ui/themes";
import { Select, SelectItem } from "@/ui/Select";
import Text from "@/ui/Text";

export const DEFAULT_ROWS_PER_PAGE_OPTIONS = [15, 25, 50, 100];

export default function RowsPerPageSelect({
  value,
  setValue,
  options = DEFAULT_ROWS_PER_PAGE_OPTIONS,
}: {
  value: number;
  setValue: (value: number) => void;
  options?: number[];
}) {
  return (
    <Flex align="center" gap="2">
      <Text size="sm" color="text-mid" whiteSpace="nowrap">
        Rows per page
      </Text>
      <Select
        value={String(value)}
        setValue={(v) => setValue(Number(v))}
        size="sm"
        aria-label="Rows per page"
      >
        {options.map((option) => (
          <SelectItem key={option} value={String(option)}>
            {String(option)}
          </SelectItem>
        ))}
      </Select>
    </Flex>
  );
}

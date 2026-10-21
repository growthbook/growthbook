import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiCalendarBlank, PiX } from "react-icons/pi";
import SelectField from "@/components/Forms/SelectField";
import { SourceTable } from "@/components/SchemaBrowser/useSourceTable";
import Tooltip from "@/components/Tooltip/Tooltip";
import Text from "@/ui/Text";

// Styled like the row filters it sits above
export default function PartitionFilterRow({
  partition,
  detectedDescription,
  autoFocus,
  onRemove,
}: {
  partition: SourceTable["partition"];
  // Shown while the detected default column is in use
  detectedDescription: string;
  autoFocus: boolean;
  onRemove: () => void;
}) {
  return (
    <Box>
      <Flex align="center" gap="2">
        <Tooltip body="Partition filter" style={{ display: "flex" }}>
          <PiCalendarBlank size={18} color="var(--gray-11)" />
        </Tooltip>
        <SelectField
          size="small"
          value={partition.column}
          onChange={partition.setColumn}
          options={partition.options.map((c) => ({
            label: c.column,
            value: c.column,
          }))}
          autoFocus={autoFocus}
          sort={false}
          placeholder="Partition column..."
        />
        <Text size="sm" color="text-mid" whiteSpace="nowrap">
          since start date
        </Text>
        {partition.column && partition.formats.length ? (
          <SelectField
            size="small"
            value={partition.format}
            onChange={partition.setFormat}
            options={partition.formats.map((f) => ({
              label: f.toUpperCase(),
              value: f,
            }))}
            sort={false}
          />
        ) : null}
        <IconButton
          type="button"
          variant="ghost"
          color="gray"
          aria-label="Remove partition filter"
          title="Remove partition filter"
          ml="1"
          onClick={onRemove}
        >
          <PiX />
        </IconButton>
      </Flex>
      {partition.column ? (
        <Text as="div" size="sm" color="text-low" mt="1" ml="6">
          {partition.isDefault ? (
            detectedDescription
          ) : (
            <code>{partition.condition}</code>
          )}
        </Text>
      ) : null}
    </Box>
  );
}

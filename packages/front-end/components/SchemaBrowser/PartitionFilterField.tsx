import { ReactNode, useState } from "react";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { PiPlus, PiX } from "react-icons/pi";
import { SourceTable } from "@/components/SchemaBrowser/useSourceTable";
import Link from "@/ui/Link";
import { Select, SelectItem } from "@/ui/Select";
import Text from "@/ui/Text";

export default function PartitionFilterField({
  partition,
  detectedDescription,
}: {
  partition: SourceTable["partition"];
  // Shown while the detected default column is in use
  detectedDescription: ReactNode;
}) {
  const [adding, setAdding] = useState(false);
  const { column } = partition;

  return (
    <Box>
      <Text as="div" size="sm" weight="medium" mb="1">
        Partition filter
      </Text>
      {column || adding ? (
        <Flex align="center" gap="2">
          <Box flexGrow="1" minWidth="0">
            <Select
              size="sm"
              mb="0"
              autoFocus={adding}
              value={column || undefined}
              setValue={(value) => {
                partition.setColumn(value);
                setAdding(false);
              }}
              placeholder="Select a column..."
            >
              {partition.options.map((c) => (
                <SelectItem key={c.column} value={c.column}>
                  {c.column}
                </SelectItem>
              ))}
            </Select>
          </Box>
          {column && partition.formats.length ? (
            <Box width="140px" flexShrink="0">
              <Select
                size="sm"
                mb="0"
                aria-label="Partition format"
                value={partition.format}
                setValue={partition.setFormat}
              >
                {partition.formats.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f.toUpperCase()}
                  </SelectItem>
                ))}
              </Select>
            </Box>
          ) : null}
          <IconButton
            type="button"
            variant="ghost"
            color="gray"
            size="1"
            aria-label="Remove partition filter"
            onClick={() => {
              partition.setColumn("");
              setAdding(false);
            }}
          >
            <PiX />
          </IconButton>
        </Flex>
      ) : (
        <Link onClick={() => setAdding(true)}>
          <Flex align="center" gap="1">
            <PiPlus /> Add partition filter
          </Flex>
        </Link>
      )}
      <Text as="div" size="sm" color="text-low" mt="1">
        {!column ? (
          "Optional. Only helps on warehouses that skip partitions, like BigQuery or Athena."
        ) : partition.isDefault ? (
          detectedDescription
        ) : (
          <code>{partition.condition}</code>
        )}
      </Text>
    </Box>
  );
}

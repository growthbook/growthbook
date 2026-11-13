import type { SourceTable } from "@/components/SchemaBrowser/useSourceTable";
import ColumnMappingRow from "@/components/SchemaBrowser/ColumnMappingRow";
import { Select, SelectItem } from "@/ui/Select";

export default function PartitionMappingRow({
  partition,
  tooltip,
}: {
  partition: SourceTable["partition"];
  /** What the partition filter limits the query to. */
  tooltip: string;
}) {
  if (!partition.available) return null;
  return (
    <ColumnMappingRow
      kind="partition"
      label="Date partition"
      tooltip={tooltip}
      value={partition.column}
      options={partition.options}
      setValue={partition.setColumn}
      onRemove={() => partition.setColumn("")}
      append={
        partition.formats.length ? (
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
        ) : null
      }
    />
  );
}

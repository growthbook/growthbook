import { UseFormReturn } from "react-hook-form";
import { FactTableDefinition } from "shared/types/fact-table";
import { CreateFactMetricFormProps } from "@/services/metrics";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Link from "@/ui/Link";
import MultiSelectField from "@/ui/MultiSelectField";
import DataList from "@/ui/DataList";

// Which fact table columns experiment results break this metric down by
// (e.g. Revenue by device: desktop / mobile / other).
export default function MetricSlices({
  form,
  factTable,
  canEdit,
}: {
  form: UseFormReturn<CreateFactMetricFormProps>;
  factTable: FactTableDefinition;
  canEdit: boolean;
}) {
  const sliceColumns = factTable.columns.filter(
    (c) =>
      c.isAutoSliceColumn &&
      !c.deleted &&
      !factTable.userIdTypes.includes(c.column),
  );
  const selected = form.watch("metricAutoSlices") || [];

  return (
    <Frame px="4" py="4" mb="0">
      <Heading as="h4" size="sm" mb="1">
        Auto Slices
      </Heading>
      {(!canEdit || sliceColumns.length > 0) && (
        <Text as="p" color="text-mid" mb="3">
          Break experiment results down by a column, such as revenue by device.
        </Text>
      )}
      {!canEdit ? (
        <DataList
          data={[
            {
              label: "Auto Slices",
              value:
                selected
                  .map(
                    (col) =>
                      factTable.columns.find((c) => c.column === col)?.name ||
                      col,
                  )
                  .join(", ") || "None",
            },
          ]}
        />
      ) : sliceColumns.length ? (
        <MultiSelectField
          label="Auto Slices"
          value={selected}
          onChange={(metricAutoSlices) =>
            form.setValue("metricAutoSlices", metricAutoSlices)
          }
          options={sliceColumns.map((c) => ({
            label: c.name || c.column,
            value: c.column,
          }))}
          placeholder="Select columns to slice by..."
        />
      ) : (
        <Text color="text-mid">
          No slice columns on this fact table.{" "}
          <Link href={`/fact-tables/${factTable.id}`}>Add one</Link>
        </Text>
      )}
    </Frame>
  );
}

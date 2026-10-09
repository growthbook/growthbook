import { UseFormReturn } from "react-hook-form";
import { Flex } from "@radix-ui/themes";
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
        Slices
      </Heading>
      <Text as="p" color="text-mid" mb="3">
        Break experiment results down by a column, such as revenue by device.
      </Text>
      {!canEdit ? (
        <DataList
          data={[
            {
              label: "Auto slices",
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
          label="Auto slices"
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
        <Flex direction="column" gap="1">
          <Text color="text-mid">
            {factTable.name} has no slice columns yet. Turn on auto slices for a
            column on the fact table to slice this metric by it.
          </Text>
          <Link href={`/fact-tables/${factTable.id}`}>Go to fact table</Link>
        </Flex>
      )}
    </Frame>
  );
}

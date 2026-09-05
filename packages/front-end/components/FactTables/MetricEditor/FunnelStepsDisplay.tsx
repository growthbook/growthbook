import { Box, Flex } from "@radix-ui/themes";
import { FunnelSettings, FunnelStep } from "shared/types/fact-table";
import { useDefinitions } from "@/services/DefinitionsContext";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import Metadata from "@/ui/Metadata";
import DataList, { DataListItem } from "@/ui/DataList";
import FilterSummary from "@/components/FactTables/MetricEditor/FilterSummary";

// Read-only Funnel steps, ported from [fmid].tsx's FunnelStepsDisplay -
// FunnelStepsInput itself has no read-only mode, so this is a separate
// renderer, not a disabled version of the input.
function FactTableLink({ id }: { id?: string }) {
  const { getFactTableById } = useDefinitions();
  const factTable = getFactTableById(id || "");
  if (!factTable) {
    return (
      <em style={{ color: "var(--color-text-mid)" }}>Unknown fact table</em>
    );
  }
  return <Link href={`/fact-tables/${factTable.id}`}>{factTable.name}</Link>;
}

export default function FunnelStepsDisplay({
  funnelSettings,
}: {
  funnelSettings: FunnelSettings;
}) {
  const { getFactTableById } = useDefinitions();

  const getStepItems = (step: FunnelStep): DataListItem[] => [
    { label: "Fact Table", value: <FactTableLink id={step.factTableId} /> },
    {
      label: "Row Filter",
      value: (
        <FilterSummary
          rowFilters={step.rowFilters || []}
          factTable={getFactTableById(step.factTableId)}
        />
      ),
    },
  ];

  const getConversionWindowValue = (
    step: FunnelStep,
    i: number,
  ): string | null =>
    step.conversionWindow
      ? i === 0
        ? `Within ${step.conversionWindow.value} ${step.conversionWindow.unit} of exposure`
        : `Within ${step.conversionWindow.value} ${step.conversionWindow.unit} of the nearest required prior step`
      : null;

  return (
    <Box>
      <Heading as="h4" size="sm" mb="2">
        Funnel Steps
      </Heading>
      {funnelSettings.steps.map((step, i) => {
        const items = getStepItems(step);
        const conversionWindowValue = getConversionWindowValue(step, i);
        const hasMetadata = !!conversionWindowValue || !!step.optional;
        return (
          <Box key={i} className="appbox" p="3" mb="2">
            <Heading
              as="h4"
              size="sm"
              mb="2"
            >{`Step ${i + 1}: ${step.name}`}</Heading>
            <DataList data={items} maxColumns={1} />
            {hasMetadata ? (
              <Flex gap="4" align="center" wrap="wrap" mt="2">
                {conversionWindowValue ? (
                  <Metadata
                    label="Conversion Window"
                    value={conversionWindowValue}
                  />
                ) : null}
                {step.optional ? (
                  <Metadata label="Optional" value="Yes" />
                ) : null}
              </Flex>
            ) : null}
          </Box>
        );
      })}
    </Box>
  );
}

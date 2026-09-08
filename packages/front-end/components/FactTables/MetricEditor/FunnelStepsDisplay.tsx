import { Flex } from "@radix-ui/themes";
import { FunnelSettings } from "shared/types/fact-table";
import { useDefinitions } from "@/services/DefinitionsContext";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Metadata from "@/ui/Metadata";
import DataList from "@/ui/DataList";
import FactTableLink from "@/components/FactTables/MetricEditor/FactTableLink";
import FilterSummary from "@/components/FactTables/MetricEditor/FilterSummary";

// Read-only Funnel steps, ported from [fmid].tsx's FunnelStepsDisplay -
// FunnelStepsInput itself has no read-only mode, so this is a separate
// renderer, not a disabled version of the input.
export default function FunnelStepsDisplay({
  funnelSettings,
}: {
  funnelSettings: FunnelSettings;
}) {
  const { getFactTableById } = useDefinitions();

  return (
    <Flex direction="column" gap="2">
      <Heading as="h4" size="sm" mb="1">
        Funnel Steps
      </Heading>
      {funnelSettings.steps.map((step, i) => {
        const items = [
          {
            label: "Fact Table",
            value: <FactTableLink id={step.factTableId} />,
          },
          ...(step.rowFilters?.length
            ? [
                {
                  label: "Row Filter",
                  value: (
                    <FilterSummary
                      rowFilters={step.rowFilters}
                      factTable={getFactTableById(step.factTableId)}
                    />
                  ),
                },
              ]
            : []),
        ];
        const conversionWindowValue = step.conversionWindow
          ? i === 0
            ? `Within ${step.conversionWindow.value} ${step.conversionWindow.unit} of exposure`
            : `Within ${step.conversionWindow.value} ${step.conversionWindow.unit} of the nearest required prior step`
          : null;
        const hasMetadata = !!conversionWindowValue || !!step.optional;
        return (
          <Frame key={i} p="3" mb="0">
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
          </Frame>
        );
      })}
    </Flex>
  );
}

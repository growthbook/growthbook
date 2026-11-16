import { Fragment } from "react";
import { Flex } from "@radix-ui/themes";
import { CompoundSettings } from "shared/types/fact-table";
import { useDefinitions } from "@/services/DefinitionsContext";
import Frame from "@/ui/Frame";
import DataList from "@/ui/DataList";
import { CompoundAndConnector } from "@/components/FactTables/CompoundComponentsInput";
import FactTableLink from "@/components/FactTables/MetricEditor/FactTableLink";
import FilterSummary from "@/components/FactTables/MetricEditor/FilterSummary";

export default function CompoundComponentsDisplay({
  compoundSettings,
}: {
  compoundSettings: CompoundSettings;
}) {
  const { getFactTableById } = useDefinitions();

  return (
    <Flex direction="column" gap="2">
      {compoundSettings.components.map((component, i) => (
        <Fragment key={i}>
          {i > 0 && <CompoundAndConnector />}
          <Frame p="3" mb="0">
            <DataList
              data={[
                {
                  label: "Fact table",
                  value: <FactTableLink id={component.factTableId} />,
                },
              ]}
              maxColumns={1}
              mb="4"
            />
            <FilterSummary
              rowFilters={component.rowFilters}
              factTable={getFactTableById(component.factTableId)}
            />
          </Frame>
        </Fragment>
      ))}
    </Flex>
  );
}

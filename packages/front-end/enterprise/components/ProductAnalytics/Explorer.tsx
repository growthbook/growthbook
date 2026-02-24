import React from "react";
import { Flex, Box } from "@radix-ui/themes";
import ShadowedScrollArea from "@/components/ShadowedScrollArea/ShadowedScrollArea";
import SelectField from "@/components/Forms/SelectField";
import { useDefinitions } from "@/services/DefinitionsContext";
import ExplorerSideBar from "./SideBar/ExplorerSideBar";
import { ExplorerProvider, useExplorerContext } from "./ExplorerContext";
import ExplorerMainSection from "./MainSection/ExplorerMainSection";
import EmptyState from "./EmptyState";

function MetricExplorerContent() {
  const { isEmpty, draftExploreState, setDraftExploreState } =
    useExplorerContext();

  const { datasources } = useDefinitions();

  if (isEmpty) {
    return <EmptyState />;
  }

  return (
    <Flex direction="column" gap="3">
      <Flex align="center" gap="3" px="2">
        <SelectField
          value={draftExploreState?.datasource || ""}
          onChange={(datasource) => {
            setDraftExploreState((prev) => {
              const newDataset = { ...prev.dataset };
              if (newDataset.type === "metric") {
                // Don't need anything besides wiping the values
                newDataset.values = [
                  {
                    metricId: "",
                    name: "Metric",
                    rowFilters: [],
                    type: "metric",
                    unit: "",
                    denominatorUnit: "",
                  },
                ];
              } else if (newDataset.type === "fact_table") {
                newDataset.factTableId = "";
                newDataset.values = [];
              } else {
                newDataset.table = "";
                newDataset.timestampColumn = "";
                newDataset.path = "";
                newDataset.columnTypes = {};
                newDataset.values = [];
              }

              console.log("Changing data source to ", datasource);

              return {
                ...prev,
                datasource,
                dataset: newDataset,
              };
            });
          }}
          options={datasources.map((d) => ({
            label: d.name,
            value: d.id,
          }))}
          placeholder="Select data source..."
          forceUndefinedValueToNull
        />
      </Flex>
      <Flex width="100%">
        {/* Main Section */}
        <Box
          style={{
            flex: "1 1 auto",
            minWidth: 0,
          }}
        >
          <ExplorerMainSection />
        </Box>

        {/* Sidebar */}
        <Box
          style={{
            flex: "0 0 320px",
            minWidth: "280px",
            maxWidth: "380px",
            padding: "var(--space-3)",
          }}
        >
          <ShadowedScrollArea height="calc(100vh - 160px)">
            <ExplorerSideBar />
          </ShadowedScrollArea>
        </Box>
      </Flex>
    </Flex>
  );
}

export default function MetricExplorer() {
  return (
    <ExplorerProvider>
      <MetricExplorerContent />
    </ExplorerProvider>
  );
}

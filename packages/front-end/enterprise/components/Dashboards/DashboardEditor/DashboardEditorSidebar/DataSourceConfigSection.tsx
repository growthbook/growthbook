import Collapsible from "react-collapsible";
import { Box, Text, Flex } from "@radix-ui/themes";
import { FaAngleRight } from "react-icons/fa";
import {
  DashboardBlockInterfaceOrData,
  DataVisualizationBlockInterface,
} from "shared/enterprise";
import { SavedQuery } from "shared/validators";
import Button from "@/ui/Button";
import SqlDataVizConfigSection from "./SqlDataVizConfigSection";

interface Props {
  block: DashboardBlockInterfaceOrData<DataVisualizationBlockInterface>;
  setBlock: React.Dispatch<
    DashboardBlockInterfaceOrData<DataVisualizationBlockInterface>
  >;
  dashboardId: string;
  projects: string[];
  savedQuery: SavedQuery | undefined;
  mutateQueries: () => void;
}

export default function DataSourceConfigSection({
  block,
  setBlock,
  dashboardId,
  projects,
  savedQuery,
  mutateQueries,
}: Props) {
  console.log("block", block);

  const currentDataSource = block.dataSourceConfig?.dataType;
  console.log("currentDataSource", currentDataSource);

  return (
    <>
      <Flex
        direction="column"
        height="100%"
        style={{
          border: "1px solid var(--gray-a3)",
          borderRadius: "var(--radius-4)",
          overflow: "hidden",
          backgroundColor: "var(--color-panel-translucent)",
        }}
      >
        <Collapsible
          open={true}
          transitionTime={100}
          trigger={
            <div
              style={{
                paddingLeft: "12px",
                paddingRight: "12px",
                paddingTop: "12px",
                paddingBottom: "12px",
                borderBottom: "1px solid var(--gray-a3)",
              }}
            >
              <Text style={{ color: "var(--color-text-mid)", fontWeight: 500 }}>
                <Flex justify="between" align="center">
                  <Flex align="center" gap="1">
                    Data Source
                  </Flex>
                  <FaAngleRight className="chevron" />
                </Flex>
              </Text>
            </div>
          }
        >
          <Box p="4" height="fit-content">
            <Flex direction="column" gap="3">
              Choose how to build your visualization
              <Flex direction="row" gap="2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setBlock({
                      ...block,
                      dataSourceConfig: { dataType: "sql", savedQueryId: "" },
                    });
                  }}
                  style={{
                    backgroundColor:
                      currentDataSource === "sql"
                        ? "var(--violet-5)"
                        : undefined,
                    flex: 1,
                  }}
                >
                  SQL Query
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setBlock({
                      ...block,
                      dataSourceConfig: {
                        dataType: "metric",
                        factMetricId: "",
                        factTableId: "",
                        metricAnalysisId: "",
                      },
                    });
                  }}
                  style={{
                    backgroundColor:
                      currentDataSource === "metric"
                        ? "var(--violet-5)"
                        : undefined,
                    flex: 1,
                  }}
                >
                  Metric
                </Button>
              </Flex>
              {currentDataSource === "sql" && (
                <SqlDataVizConfigSection
                  block={block}
                  setBlock={setBlock}
                  dashboardId={dashboardId}
                  projects={projects}
                  savedQuery={savedQuery}
                  mutateQueries={mutateQueries}
                />
              )}
              {currentDataSource === "metric" && (
                <Flex direction="column" gap="3">
                  Metric flow - To be completed in future PRs
                </Flex>
              )}
              {/* Add dimensions section here */}
              {/* Add filters section here */}
            </Flex>
          </Box>
        </Collapsible>
      </Flex>
    </>
  );
}

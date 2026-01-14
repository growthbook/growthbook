import { useCallback, useMemo } from "react";
import { Flex } from "@radix-ui/themes";
import {
  DashboardBlockInterfaceOrData,
  DataVisualizationBlockInterface,
  chartTypeHasDisplaySettings,
} from "shared/enterprise";
import { DataVizConfig, SavedQuery } from "shared/validators";
import useApi from "@/hooks/useApi";
import DataVizDimensionPanel from "@/components/DataViz/DataVizDimensionPanel";
import DataVizFilterPanel from "@/components/DataViz/DataVizFilterPanel";
import DisplaySettingsPanel from "@/components/DataViz/DisplaySettingsPanel/DisplaySettingsPanel";
import AnchorYAxisToZeroCheckbox from "@/components/DataViz/DisplaySettingsPanel/AnchorYAxisToZeroCheckbox";
import ChartTypeConfigSection from "./ChartTypeConfigSection";
import DataSourceConfigSection from "./DataSourceConfigSection";
import AxesConfigSection from "./AxesConfigSection";

interface Props {
  block: DashboardBlockInterfaceOrData<DataVisualizationBlockInterface>;
  setBlock: React.Dispatch<
    DashboardBlockInterfaceOrData<DataVisualizationBlockInterface>
  >;
  dashboardId: string;
  projects: string[];
}

export default function DataVisualizationSettings({
  block,
  setBlock,
  dashboardId,
  projects,
}: Props) {
  const { data: savedQueriesData, mutate: mutateQueries } = useApi<{
    status: number;
    savedQueries: SavedQuery[];
  }>(`/saved-queries/`);

  const savedQueryId =
    block.dataSourceConfig?.dataType === "sql"
      ? block.dataSourceConfig.savedQueryId
      : undefined;

  const savedQuery = useMemo(
    () =>
      savedQueryId
        ? savedQueriesData?.savedQueries?.find(
            (q: SavedQuery) => q.id === savedQueryId,
          )
        : undefined,
    [savedQueryId, savedQueriesData?.savedQueries],
  );

  const rows = useMemo(
    () => savedQuery?.results?.results || [],
    [savedQuery?.results?.results],
  );

  const axisKeys = useMemo(() => {
    return Object.keys(rows[0] || {});
  }, [rows]);

  const currentDataVizConfig = useMemo(
    () => block.dataVizConfig?.[0] ?? {},
    [block.dataVizConfig],
  );

  const onDataVizConfigChange = useCallback(
    (newConfig: Partial<DataVizConfig>) => {
      setBlock({
        ...block,
        dataVizConfig: [
          {
            ...currentDataVizConfig,
            ...newConfig,
          } as DataVizConfig,
        ],
      });
    },
    [block, setBlock, currentDataVizConfig],
  );

  return (
    <Flex direction="column" gap="3" my="3">
      <ChartTypeConfigSection block={block} setBlock={setBlock} />
      <DataSourceConfigSection
        block={block}
        setBlock={setBlock}
        dashboardId={dashboardId}
        projects={projects}
        savedQuery={savedQuery}
        mutateQueries={mutateQueries}
      />
      {block.dataSourceConfig?.dataType === "sql" &&
        savedQuery &&
        savedQuery.results?.results && (
          <>
            <AxesConfigSection
              block={block}
              setBlock={setBlock}
              rows={rows}
              axisKeys={axisKeys}
            />
            <DataVizDimensionPanel
              dataVizConfig={block.dataVizConfig?.[0] ?? {}}
              onDataVizConfigChange={onDataVizConfigChange}
              axisKeys={axisKeys}
            />
            <DataVizFilterPanel
              dataVizConfig={block.dataVizConfig?.[0] ?? {}}
              onDataVizConfigChange={onDataVizConfigChange}
              rows={rows}
            />
            {chartTypeHasDisplaySettings(
              block.dataVizConfig?.[0]?.chartType,
            ) && (
              <DisplaySettingsPanel>
                <AnchorYAxisToZeroCheckbox
                  dataVizConfig={block.dataVizConfig?.[0] ?? {}}
                  onDataVizConfigChange={onDataVizConfigChange}
                />
              </DisplaySettingsPanel>
            )}
          </>
        )}
    </Flex>
  );
}

import { useMemo } from "react";
import { Flex } from "@radix-ui/themes";
import {
  DashboardBlockInterfaceOrData,
  DataVisualizationBlockInterface,
} from "shared/enterprise";
import { SavedQuery } from "shared/validators";
import useApi from "@/hooks/useApi";
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
          <AxesConfigSection
            block={block}
            setBlock={setBlock}
            savedQuery={savedQuery}
          />
        )}
    </Flex>
  );
}

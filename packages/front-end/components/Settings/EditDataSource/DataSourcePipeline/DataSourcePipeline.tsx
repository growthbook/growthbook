import { useCallback, useState } from "react";
import { DataSourceType } from "back-end/types/datasource";
import { Box, Card, Flex, Heading, Text } from "@radix-ui/themes";
import { DataSourceQueryEditingModalBaseProps } from "@/components/Settings/EditDataSource/types";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Button from "@/ui/Button";
import Badge from "@/ui/Badge";
import { EditDataSourcePipeline } from "./EditDataSourcePipeline";

type DataSourcePipelineProps = DataSourceQueryEditingModalBaseProps;

export function dataSourcePathNames(dataSourceType: DataSourceType): {
  databaseName: string;
  schemaName: string;
} {
  let databaseName = "database";
  let schemaName = "schema";
  if (dataSourceType === "bigquery") {
    databaseName = "project";
    schemaName = "dataset";
  }
  if (dataSourceType === "databricks") {
    databaseName = "catalog";
  }
  return { databaseName, schemaName };
}

export default function DataSourcePipeline({
  dataSource,
  onSave,
  canEdit,
}: DataSourcePipelineProps) {
  const [uiMode, setUiMode] = useState<"view" | "edit">("view");

  const pipelineSettings = dataSource.settings.pipelineSettings;

  const handleCancel = useCallback(() => {
    setUiMode("view");
  }, []);
  const permissionsUtil = usePermissionsUtil();
  canEdit = canEdit && permissionsUtil.canUpdateDataSourceSettings(dataSource);

  return (
    <Box>
      <Flex align="center" justify="start" mb="3" gap="3">
        <Heading as="h3" size="4" mb="0">
          Data Pipeline Settings
        </Heading>
        <Badge label="Beta" color="teal" />
      </Flex>
      <p>
        Configure how GrowthBook can use write permissions to your Data Source
        to improve the performance of experiment queries, including enabling
        incremental refresh.
      </p>
      <Card>
        <Box px="3" py="2">
          <Flex
            align={pipelineSettings?.allowWriting ? "start" : "center"}
            justify="between"
          >
            <Box>
              <Text weight="medium" mb="0" as="p">
                {"Data Pipeline: "}
                {pipelineSettings?.allowWriting ? "Enabled" : "Disabled"}
              </Text>
              {pipelineSettings?.allowWriting && (
                <>
                  <Box mt="2">
                    {"Mode: "}
                    <code>{pipelineSettings?.mode ?? "temporary"}</code>
                  </Box>
                  {pipelineSettings?.partitionSettings ? (
                    <Box mt="2">
                      {"Partition: "}
                      {pipelineSettings.partitionSettings.type ===
                      "timestamp" ? (
                        <code>timestamp</code>
                      ) : (
                        <>
                          <code>yearMonthDate</code>
                          {" ["}
                          <code>
                            year={pipelineSettings.partitionSettings.yearColumn}
                          </code>
                          {", "}
                          <code>
                            month=
                            {pipelineSettings.partitionSettings.monthColumn}
                          </code>
                          {", "}
                          <code>
                            date={pipelineSettings.partitionSettings.dateColumn}
                          </code>
                          {"]"}
                        </>
                      )}
                    </Box>
                  ) : null}
                  <Box mt="2">
                    {`Destination ${
                      dataSourcePathNames(dataSource.type).schemaName
                    }: `}
                    {pipelineSettings?.writeDataset ? (
                      <code>{`${
                        pipelineSettings?.writeDatabase
                          ? pipelineSettings?.writeDatabase + "."
                          : ""
                      }${pipelineSettings.writeDataset}`}</code>
                    ) : (
                      <em className="text-muted">not specified</em>
                    )}
                  </Box>
                  {dataSource.type === "databricks" ? (
                    <Box mt="2">
                      {
                        "Drop units table when analysis finishes (recommended): "
                      }
                      {pipelineSettings?.unitsTableDeletion
                        ? "Enabled"
                        : "Disabled"}
                    </Box>
                  ) : (pipelineSettings?.mode ?? "temporary") ===
                    "temporary" ? (
                    <Box mt="2">
                      {"Retention of temporary units table (hours): "}
                      {pipelineSettings?.unitsTableRetentionHours ?? 24}
                    </Box>
                  ) : null}
                </>
              )}
            </Box>
            {canEdit && (
              <Box>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setUiMode("edit");
                  }}
                >
                  Edit
                </Button>
              </Box>
            )}
          </Flex>
        </Box>
      </Card>

      {uiMode === "edit" ? (
        <EditDataSourcePipeline
          onSave={onSave}
          onCancel={handleCancel}
          dataSource={dataSource}
        />
      ) : null}
    </Box>
  );
}

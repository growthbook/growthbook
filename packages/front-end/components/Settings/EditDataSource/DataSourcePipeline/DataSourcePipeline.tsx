import { useCallback, useState } from "react";
import { DataSourceType } from "shared/types/datasource";
import type { PartitionSettings } from "shared/types/integrations";
import { getRequiredColumnsForPipelineSettings } from "shared/enterprise";
import { Box, Card, Flex, Heading, Text } from "@radix-ui/themes";
import { DataSourceQueryEditingModalBaseProps } from "@/components/Settings/EditDataSource/types";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Badge from "@/ui/Badge";
import Link from "@/ui/Link";
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

  function getTitle() {
    if (pipelineSettings?.allowWriting) {
      if (pipelineSettings?.mode === "incremental") {
        return "Enabled (Incremental)";
      }
      if (pipelineSettings?.mode === "ephemeral") {
        return "Enabled (Ephemeral)";
      }
      const _exhaustiveCheck: never = pipelineSettings?.mode;
      return "Enabled";
    }
    return "Disabled";
  }

  function getDescription() {
    if (pipelineSettings?.allowWriting) {
      if (pipelineSettings?.mode === "incremental") {
        return "Maintain incremental tables with new data to reduce re-scans of data.";
      }
      if (pipelineSettings?.mode === "ephemeral") {
        return "Create temporary tables per-experiment refresh.";
      }
      const _exhaustiveCheck: never = pipelineSettings?.mode;
      return "Create intermediate tables to improve query performance.";
    }
    return "Run read queries only, no intermediate tables written.";
  }

  return (
    <Box>
      <Flex align="center" justify="between" gap="3" mb="2">
        <Flex align="center" justify="start" gap="2">
          <Heading as="h3" size="4" mb="0">
            Data Pipeline Settings
          </Heading>
          <Badge label="BETA" color="gray" variant="solid" />
        </Flex>
        {canEdit && (
          <Link
            weight="medium"
            underline="none"
            onClick={() => {
              setUiMode("edit");
            }}
          >
            Edit
          </Link>
        )}
      </Flex>
      <p>
        Improve the performance of experiment queries by writing intermediate
        tables to your Data Source.
      </p>

      <Card>
        <Flex direction="column" gap="3" p="2">
          <Flex direction="column" gap="1">
            <Text
              size="3"
              weight="medium"
              style={{
                color: pipelineSettings?.allowWriting
                  ? "var(--color-text-high)"
                  : "var(--color-text-low)",
              }}
            >
              {getTitle()}
            </Text>
            <Text size="2" style={{ color: "var(--color-text-mid)" }}>
              {getDescription()}
            </Text>
          </Flex>
          {pipelineSettings?.allowWriting && (
            <Flex direction="row" gap="4" align="center" wrap="wrap">
              <Box>
                <Text weight="medium">
                  Destination {dataSourcePathNames(dataSource.type).schemaName}
                  :{" "}
                </Text>
                <code>
                  {`${
                    pipelineSettings?.writeDatabase
                      ? pipelineSettings?.writeDatabase + "."
                      : "(default)."
                  }${pipelineSettings.writeDataset}`}
                </code>
              </Box>
              {pipelineSettings.mode === "incremental" &&
              pipelineSettings.partitionSettings ? (
                <Box>
                  <Text weight="medium">Partition Strategy: </Text>
                  <PartitionSettingsSummary
                    settings={pipelineSettings.partitionSettings}
                  />
                </Box>
              ) : null}
            </Flex>
          )}
        </Flex>
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

function PartitionSettingsSummary({
  settings,
}: {
  settings: PartitionSettings;
}) {
  const columns = getRequiredColumnsForPipelineSettings({
    allowWriting: true,
    mode: "incremental",
    writeDataset: "",
    unitsTableRetentionHours: 24,
    partitionSettings: settings,
  });

  return (
    <code>
      {settings.type}
      {columns.length > 0 ? ` (${columns.join(", ")})` : ""}
    </code>
  );
}

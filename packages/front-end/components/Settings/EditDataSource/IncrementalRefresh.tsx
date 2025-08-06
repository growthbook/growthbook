import { useCallback, useState } from "react";
import {
  Box,
  Card,
  Flex,
  Heading,
  Text,
  Switch,
  TextField,
} from "@radix-ui/themes";
import cloneDeep from "lodash/cloneDeep";
import { DataSourceQueryEditingModalBaseProps } from "@/components/Settings/EditDataSource/types";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Badge from "@/components/Radix/Badge";
import Button from "@/components/Radix/Button";
import { useDefinitions } from "@/services/DefinitionsContext";

type IncrementalRefreshProps = DataSourceQueryEditingModalBaseProps;

export default function IncrementalRefresh({
  dataSource,
  onSave,
  canEdit,
}: IncrementalRefreshProps) {
  const { factTables } = useDefinitions();
  const [isEnabled, setIsEnabled] = useState(
    dataSource.settings.incrementalRefresh?.enabled ?? false
  );
  const [hasChanges, setHasChanges] = useState(false);

  // Get exposure queries and fact tables for this data source
  const exposureQueries = dataSource.settings?.queries?.exposure || [];
  const dataSourceFactTables = factTables.filter(
    (ft) => ft.datasource === dataSource.id
  );

  // State for partition column configuration (centralized in datasource)
  const [partitionColumnConfig, setPartitionColumnConfig] = useState<
    Record<string, string>
  >(() => {
    return dataSource.settings.incrementalRefresh?.partitionColumnConfig || {};
  });

  const permissionsUtil = usePermissionsUtil();
  canEdit = canEdit && permissionsUtil.canUpdateDataSourceSettings(dataSource);

  const handleToggle = useCallback((enabled: boolean) => {
    setIsEnabled(enabled);
    setHasChanges(true);
    if (!enabled) {
      // Clear all partition column names when disabled
      setPartitionColumnConfig({});
    }
  }, []);

  const handlePartitionColumnChange = useCallback(
    (id: string, value: string) => {
      setPartitionColumnConfig((prev) => ({
        ...prev,
        [id]: value,
      }));
      setHasChanges(true);
    },
    []
  );

  const handleSave = useCallback(async () => {
    const updatedDataSource = cloneDeep(dataSource);

    // Update the incremental refresh settings with centralized config
    updatedDataSource.settings.incrementalRefresh = {
      enabled: isEnabled,
      partitionColumnConfig: isEnabled ? partitionColumnConfig : {},
    };

    await onSave(updatedDataSource);
    setHasChanges(false);
  }, [dataSource, onSave, isEnabled, partitionColumnConfig]);

  return (
    <Box>
      <Flex align="center" justify="start" mb="3" gap="3">
        <Heading as="h3" size="4" mb="0">
          Incremental Refresh
        </Heading>
        <Badge label="Beta" color="teal" />
      </Flex>
      <Text as="p" mb="4" color="gray">
        Enable incremental refresh to improve query performance by only
        processing new data since the last refresh. Configure partition columns
        for each assignment query and fact table.
      </Text>

      <Card>
        <Box px="4" py="3">
          <Flex direction="column" gap="4">
            <Flex align="center" justify="between">
              <Box>
                <Text weight="medium" size="3" mb="1" as="p">
                  Incremental Refresh
                </Text>
                <Text size="2" color="gray" as="p">
                  {isEnabled
                    ? "Queries will use incremental refresh when possible"
                    : "All queries will run against the full dataset"}
                </Text>
              </Box>
              <Switch
                checked={isEnabled}
                onCheckedChange={handleToggle}
                disabled={!canEdit}
              />
            </Flex>

            {isEnabled && (
              <Flex direction="column" gap="4">
                {/* Experiment Assignment Queries */}
                {exposureQueries.length > 0 && (
                  <Box>
                    <Text weight="medium" size="3" mb="3" as="p">
                      Experiment Assignment Queries
                    </Text>
                    <Flex direction="column" gap="3">
                      {exposureQueries.map((query) => (
                        <Box key={query.id}>
                          <Text weight="medium" size="2" mb="2" as="label">
                            {query.name}
                          </Text>
                          <TextField.Root
                            value={partitionColumnConfig[query.id] || ""}
                            onChange={(e) =>
                              handlePartitionColumnChange(
                                query.id,
                                e.target.value
                              )
                            }
                            placeholder="Enter partition column name (e.g., timestamp, created_at)"
                            disabled={!canEdit}
                          />
                          {query.description && (
                            <Text size="1" color="gray" mt="1" as="p">
                              {query.description}
                            </Text>
                          )}
                        </Box>
                      ))}
                    </Flex>
                  </Box>
                )}

                {/* Fact Tables */}
                {dataSourceFactTables.length > 0 && (
                  <Box>
                    <Text weight="medium" size="3" mb="3" as="p">
                      Fact Tables
                    </Text>
                    <Flex direction="column" gap="3">
                      {dataSourceFactTables.map((factTable) => (
                        <Box key={factTable.id}>
                          <Text weight="medium" size="2" mb="2" as="label">
                            {factTable.name}
                          </Text>
                          <TextField.Root
                            value={partitionColumnConfig[factTable.id] || ""}
                            onChange={(e) =>
                              handlePartitionColumnChange(
                                factTable.id,
                                e.target.value
                              )
                            }
                            placeholder="Enter partition column name (e.g., timestamp, created_at)"
                            disabled={!canEdit}
                          />
                          {factTable.description && (
                            <Text size="1" color="gray" mt="1" as="p">
                              {factTable.description}
                            </Text>
                          )}
                        </Box>
                      ))}
                    </Flex>
                  </Box>
                )}

                {/* Empty state */}
                {exposureQueries.length === 0 &&
                  dataSourceFactTables.length === 0 && (
                    <Box>
                      <Text size="2" color="gray" as="p">
                        No experiment assignment queries or fact tables found
                        for this data source. Create some first to configure
                        partition columns.
                      </Text>
                    </Box>
                  )}
              </Flex>
            )}

            {hasChanges && canEdit && (
              <Flex justify="end">
                <Button onClick={handleSave} variant="solid">
                  Save Changes
                </Button>
              </Flex>
            )}
          </Flex>
        </Box>
      </Card>
    </Box>
  );
}

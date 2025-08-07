import { useCallback, useState } from "react";
import { Box, Card, Flex, Heading, Text, Switch } from "@radix-ui/themes";
import cloneDeep from "lodash/cloneDeep";
import { DataSourceQueryEditingModalBaseProps } from "@/components/Settings/EditDataSource/types";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Badge from "@/components/Radix/Badge";

type IncrementalRefreshProps = DataSourceQueryEditingModalBaseProps;

export default function IncrementalRefresh({
  dataSource,
  onSave,
  canEdit,
}: IncrementalRefreshProps) {
  const [isEnabled, setIsEnabled] = useState(
    dataSource.settings.incrementalRefresh?.enabled ?? false
  );

  const permissionsUtil = usePermissionsUtil();
  canEdit = canEdit && permissionsUtil.canUpdateDataSourceSettings(dataSource);

  const handleToggle = useCallback(
    async (enabled: boolean) => {
      setIsEnabled(enabled);
      const updatedDataSource = cloneDeep(dataSource);
      updatedDataSource.settings.incrementalRefresh = {
        enabled,
      };
      await onSave(updatedDataSource);
    },
    [dataSource, onSave]
  );

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
        processing new data since the last refresh.
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
          </Flex>
        </Box>
      </Card>
    </Box>
  );
}

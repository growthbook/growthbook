import { useFormContext } from "react-hook-form";
import { DEFAULT_TEST_QUERY_DAYS } from "shared/constants";
import { Box, Flex, Heading, Text } from "@radix-ui/themes";
import React from "react";
import SelectField from "@/components/Forms/SelectField";
import { useDefinitions } from "@/services/DefinitionsContext";
import Field from "@/components/Forms/Field";
import Frame from "@/ui/Frame";

export default function DatasourceSettings() {
  const form = useFormContext();
  const { datasources } = useDefinitions();

  return (
    <Frame>
      <Flex gap="4">
        <Box width="220px" flexShrink="0">
          <Heading size="4" as="h4">
            Data Source Settings
          </Heading>
        </Box>
        <Flex align="start" direction="column" flexGrow="1" pt="6">
          {/* Default data source */}

          <Box mb="6" width="100%">
            <Text as="label" className="font-weight-semibold" size="3">
              Default Data Source (Optional)
            </Text>
            <Box mb="3">
              The default data source is the default data source selected when
              creating metrics and experiments.
            </Box>
            <Box width="400px">
              <SelectField
                value={form.watch("defaultDataSource") || ""}
                options={datasources.map((d) => ({
                  label: d.name,
                  value: d.id,
                }))}
                onChange={(v: string) => form.setValue("defaultDataSource", v)}
                isClearable={true}
                placeholder="Select a data source..."
              />
            </Box>
          </Box>

          <Box mb="6" width="100%">
            <Text as="label" className="font-weight-semibold" size="3">
              Test Query Lookback Length
            </Text>
            <Box mb="3">
              {`The number of days to look back when running test queries that have a date filters. Also used when validating fact table SQL. If
                empty, uses default of ${DEFAULT_TEST_QUERY_DAYS} days.`}
            </Box>
            <Box width="200px">
              <Field
                type="number"
                min="1"
                append="days"
                {...form.register("testQueryDays", {
                  valueAsNumber: true,
                })}
              />
            </Box>
          </Box>
        </Flex>
      </Flex>
    </Frame>
  );
}

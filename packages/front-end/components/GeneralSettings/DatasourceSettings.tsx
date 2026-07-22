import { useFormContext } from "react-hook-form";
import { DEFAULT_TEST_QUERY_DAYS } from "shared/constants";
import { DEFAULT_TOP_VALUES_LOOKBACK_VALUE } from "shared/settings";
import { Box, Flex, Heading, Text } from "@radix-ui/themes";
import React from "react";
import SelectField from "@/components/Forms/SelectField";
import { useDefinitions } from "@/services/DefinitionsContext";
import { hasFileConfig } from "@/services/env";
import Field from "@/components/Forms/Field";
import { GBInfo } from "@/components/Icons";
import Tooltip from "@/ui/Tooltip";
import Frame from "@/ui/Frame";

export default function DatasourceSettings() {
  const form = useFormContext();
  const { datasources } = useDefinitions();

  return (
    <Frame id="data-source-settings" style={{ scrollMarginTop: 100 }}>
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
              Default Data Source
            </Text>
            <Box mb="3">
              The default Data Source is the default Data Source selected when
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
                placeholder="Select a Data Source..."
              />
            </Box>
          </Box>

          <Box mb="6" width="100%">
            <Text as="label" className="font-weight-semibold" size="3">
              Test query lookback window
            </Text>
            <Box mb="3">
              {`The number of days to look back when running test queries that have date filters. Also used when validating fact table SQL. Default is ${DEFAULT_TEST_QUERY_DAYS} days.`}
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

          <Box
            id="top-values-lookback"
            mb="6"
            width="100%"
            style={{ scrollMarginTop: 100 }}
          >
            <Text as="label" className="font-weight-semibold" size="3">
              Top values lookback window
              <Tooltip content="GrowthBook queries the fact table with this lookback window to power Auto Slice values and suggestions when you filter metrics. A longer window finds more values but costs more to scan.">
                <Flex
                  ml="2"
                  display="inline-flex"
                  style={{ verticalAlign: "middle" }}
                >
                  <GBInfo />
                </Flex>
              </Tooltip>
            </Text>
            <Box mb="3">
              {`Number of days of recent data to scan to get top values per column. It is also used when Fact Table Auto-update slice levels is enabled. Default is ${DEFAULT_TOP_VALUES_LOOKBACK_VALUE}.`}
            </Box>
            <Box width="200px">
              <Field
                type="number"
                append="days"
                min="1"
                max="365"
                step="1"
                disabled={hasFileConfig()}
                {...form.register("topValuesLookbackValue", {
                  valueAsNumber: true,
                  min: 1,
                  max: 365,
                })}
              />
            </Box>
          </Box>
        </Flex>
      </Flex>
    </Frame>
  );
}

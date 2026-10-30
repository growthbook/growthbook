import { useFormContext } from "react-hook-form";
import { DEFAULT_TEST_QUERY_DAYS } from "shared/constants";
import { DEFAULT_TOP_VALUES_LOOKBACK_VALUE } from "shared/settings";
import { Box, Flex } from "@radix-ui/themes";
import React from "react";
import { useSettingsForm } from "@/components/GeneralSettings/SettingsFormProvider";
import SelectField from "@/components/Forms/SelectField";
import { useDefinitions } from "@/services/DefinitionsContext";
import { hasFileConfig } from "@/services/env";
import Field from "@/components/Forms/Field";
import { GBInfo } from "@/components/Icons";
import Tooltip from "@/ui/Tooltip";
import { SettingsField, SettingsGroup } from "./SettingsGroup";

export default function DatasourceSettings() {
  const form = useFormContext();
  const { defaultFor } = useSettingsForm();
  const { datasources } = useDefinitions();

  return (
    <SettingsGroup
      id="data-source-settings"
      title="Data Source Defaults"
      description="Applied when creating metrics, experiments, and test queries."
      keywords="default data source warehouse test query lookback top values slices"
    >
      <SettingsField
        name="defaultDataSource"
        htmlFor="settings-defaultDataSource"
        label="Default Data Source"
        help="Preselected when creating metrics and experiments."
      >
        <Box width="400px" maxWidth="100%">
          <SelectField
            id="settings-defaultDataSource"
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
      </SettingsField>

      <SettingsField
        name="testQueryDays"
        htmlFor="settings-testQueryDays"
        label="Test query lookback"
        help={`Days of data for test queries with date filters and fact table SQL validation. Default is ${DEFAULT_TEST_QUERY_DAYS}.`}
      >
        <Box width="200px">
          <Field
            id="settings-testQueryDays"
            size="md"
            type="number"
            min="1"
            append="days"
            containerClassName="mb-0"
            placeholder={defaultFor("testQueryDays")}
            {...form.register("testQueryDays", {
              valueAsNumber: true,
            })}
          />
        </Box>
      </SettingsField>

      <Box id="top-values-lookback" style={{ scrollMarginTop: 100 }}>
        <SettingsField
          name="topValuesLookbackValue"
          htmlFor="settings-topValuesLookbackValue"
          label={
            <>
              Top values lookback
              <Tooltip content="GrowthBook queries the fact table with this lookback window to power Auto Slice values and suggestions when you filter metrics. A longer window finds more values but costs more to scan.">
                <Flex
                  ml="2"
                  display="inline-flex"
                  style={{ verticalAlign: "middle" }}
                >
                  <GBInfo />
                </Flex>
              </Tooltip>
            </>
          }
          help={`Days of data scanned for top column values, including Auto-update slice levels. Default is ${DEFAULT_TOP_VALUES_LOOKBACK_VALUE}.`}
        >
          <Box width="200px">
            <Field
              id="settings-topValuesLookbackValue"
              type="number"
              append="days"
              min="1"
              max="365"
              step="1"
              containerClassName="mb-0"
              disabled={hasFileConfig()}
              placeholder={defaultFor("topValuesLookbackValue")}
              {...form.register("topValuesLookbackValue", {
                valueAsNumber: true,
                min: 1,
                max: 365,
              })}
            />
          </Box>
        </SettingsField>
      </Box>
    </SettingsGroup>
  );
}

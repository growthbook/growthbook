import { useFormContext } from "react-hook-form";
import { Box } from "@radix-ui/themes";
import React from "react";
import { DEFAULT_MAX_METRIC_SLICE_LEVELS } from "shared/settings";
import { useSettingsForm } from "@/components/GeneralSettings/SettingsFormProvider";
import { hasFileConfig } from "@/services/env";
import { supportedCurrencies } from "@/services/settings";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import { useUser } from "@/services/UserContext";
import PaidFeatureBadge from "@/components/GetStarted/PaidFeatureBadge";
import { SettingsField, SettingsGroup, UnsavedMark } from "./SettingsGroup";

export default function MetricsSettings() {
  const form = useFormContext();
  const { defaultFor } = useSettingsForm();
  const { hasCommercialFeature } = useUser();
  const metricAnalysisDays = form.watch("metricAnalysisDays");
  const metricAnalysisDaysWarningMsg =
    metricAnalysisDays && metricAnalysisDays > 365
      ? "Using more historical data will slow down metric analysis queries"
      : "";
  const maxMetricSliceLevels = form.watch("maxMetricSliceLevels");
  const maxMetricSliceLevelsWarningMsg =
    maxMetricSliceLevels && maxMetricSliceLevels > 20
      ? "Using too many slice levels may increase query costs substantially. All Auto Slice levels are analyzed every time an experiment refreshes."
      : "";
  const currencyOptions = Object.entries(supportedCurrencies).map(
    ([value, label]) => ({ value, label }),
  );

  const numberField = (
    name: string,
    options: { append?: string; min?: number; max?: number; step?: number },
  ) => (
    <Box width="200px">
      <Field
        size="md"
        type="number"
        containerClassName="mb-0"
        append={options.append}
        min={options.min}
        max={options.max}
        step={options.step}
        disabled={hasFileConfig()}
        placeholder={defaultFor(name)}
        {...form.register(name, {
          valueAsNumber: true,
          min: options.min,
          max: options.max,
        })}
      />
    </Box>
  );

  return (
    <>
      <SettingsGroup
        id="m-analysis"
        title="Metric Analysis"
        description="Settings for the metric analysis page."
        keywords="lookback window history"
      >
        <SettingsField
          name="metricAnalysisDays"
          label="Lookback window"
          help="Historical data used on the metric analysis page."
        >
          {numberField("metricAnalysisDays", { append: "days" })}
          {metricAnalysisDaysWarningMsg && (
            <Callout status="warning" mt="2">
              {metricAnalysisDaysWarningMsg}
            </Callout>
          )}
        </SettingsField>
      </SettingsGroup>

      <SettingsGroup
        id="m-defaults"
        title="Metric Behavior Defaults"
        description="Defaults for new metrics. Each metric can override these."
        keywords="minimum total sample size threshold suspicious outlier draw mde minimum detectable effect currency revenue"
      >
        <SettingsField
          name="metricDefaults.minimumSampleSize"
          label="Minimum metric total"
          help="Total a variation needs before results are shown."
        >
          {numberField("metricDefaults.minimumSampleSize", { min: 0 })}
        </SettingsField>
        <SettingsField
          name="metricDefaults.maxPercentageChange"
          label="Maximum percentage change"
          help="Larger changes are flagged as suspicious."
        >
          {numberField("metricDefaults.maxPercentageChange", {
            min: 0,
            append: "%",
          })}
        </SettingsField>
        <SettingsField
          name="metricDefaults.minPercentageChange"
          label="Minimum percentage change"
          help="Smaller changes are treated as a draw."
        >
          {numberField("metricDefaults.minPercentageChange", {
            min: 0,
            append: "%",
          })}
        </SettingsField>
        <SettingsField
          name="metricDefaults.targetMDE"
          label="Target minimum detectable effect"
          help="The change you want to reliably detect. Used to estimate days left. Lower values need more data."
        >
          {numberField("metricDefaults.targetMDE", { min: 0, append: "%" })}
        </SettingsField>
        <SettingsField
          name="displayCurrency"
          htmlFor="settings-displayCurrency"
          label="Display currency"
          help="Should match the currency stored in your Data Source."
        >
          <Box width="320px">
            <SelectField
              id="settings-displayCurrency"
              value={form.watch("displayCurrency") || "USD"}
              options={currencyOptions}
              onChange={(v: string) => form.setValue("displayCurrency", v)}
              required
              markRequired
              placeholder="Select a currency..."
            />
          </Box>
        </SettingsField>
      </SettingsGroup>

      <SettingsGroup
        id="m-slices"
        title="Metric Types and Slices"
        description="Which metric types can be created, and limits for Auto Slices."
        keywords="fact metrics legacy metric creation auto slice levels dimensions"
      >
        <UnsavedMark name="disableLegacyMetricCreation">
          <Checkbox
            id="toggle-disableLegacyMetricCreation"
            label="Require Fact Metrics"
            description="Turns off legacy metric creation."
            value={!!form.watch("disableLegacyMetricCreation")}
            setValue={(value) => {
              form.setValue("disableLegacyMetricCreation", value);
            }}
          />
        </UnsavedMark>
        <SettingsField
          name="maxMetricSliceLevels"
          htmlFor="settings-maxMetricSliceLevels"
          label={
            <>
              Max Auto Slice levels
              <PaidFeatureBadge
                commercialFeature="metric-slices"
                premiumText="This is an Enterprise feature"
                variant="outline"
                ml="2"
              />
            </>
          }
          help={
            hasCommercialFeature("metric-slices")
              ? `Most levels allowed per metric. Default is ${DEFAULT_MAX_METRIC_SLICE_LEVELS}.`
              : "This feature requires an Enterprise license."
          }
        >
          <Box width="200px">
            <Field
              id="settings-maxMetricSliceLevels"
              size="md"
              type="number"
              min="0"
              max="200"
              step="1"
              append="levels"
              containerClassName="mb-0"
              disabled={
                hasFileConfig() || !hasCommercialFeature("metric-slices")
              }
              placeholder={defaultFor("maxMetricSliceLevels")}
              {...form.register("maxMetricSliceLevels", {
                valueAsNumber: true,
                min: 0,
                max: 200,
              })}
            />
          </Box>
          {maxMetricSliceLevelsWarningMsg && (
            <Callout status="warning" mt="2">
              {maxMetricSliceLevelsWarningMsg}
            </Callout>
          )}
        </SettingsField>
      </SettingsGroup>
    </>
  );
}

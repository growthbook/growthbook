import React, { FC, useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import {
  AttributionModel,
  LookbackOverride,
  LookbackOverrideValueUnit,
} from "shared/types/experiment";
import {
  DEFAULT_LOOKBACK_OVERRIDE_VALUE_DAYS,
  DEFAULT_LOOKBACK_OVERRIDE_VALUE_UNIT,
} from "shared/constants";
import DatePicker from "@/components/DatePicker";
import Field from "@/components/Forms/Field";
import RadioGroup from "@/ui/RadioGroup";
import SelectField from "@/components/Forms/SelectField";
import HelperText from "@/ui/HelperText";
import { GBInfo } from "@/components/Icons";
import { AttributionModelTooltip } from "./AttributionModelTooltip";

export type MetricAnalysisWindowMode =
  | "metric" // Use Metric Settings
  | "ignore" // Ignore Conversion Windows
  | "custom"; // Use Custom Lookback Window

export type MetricAnalysisWindowSelectorProps = {
  attributionModel: AttributionModel;
  lookbackOverride: LookbackOverride | undefined;
  onAttributionModelChange: (model: AttributionModel) => void;
  onLookbackOverrideChange: (value?: LookbackOverride) => void;
  disabled?: boolean;
  /** For reports: analysis end date used to compute lookback when type is "date" */
  analysisEndDate?: Date | null;
  /** For experiments: phase end date or now */
  phaseEndDate?: Date | null;
  helpText?: React.ReactNode;
};

const MetricAnalysisWindowSelector: FC<MetricAnalysisWindowSelectorProps> = ({
  attributionModel,
  lookbackOverride,
  onAttributionModelChange,
  onLookbackOverrideChange,
  disabled = false,
  analysisEndDate,
  phaseEndDate,
  helpText,
}) => {
  const endDate = analysisEndDate ?? phaseEndDate ?? new Date();
  const [localWindowValue, setLocalWindowValue] = useState<string | null>(null);

  const mode: MetricAnalysisWindowMode =
    attributionModel === "lookbackOverride" && lookbackOverride
      ? "custom"
      : attributionModel === "experimentDuration"
        ? "ignore"
        : "metric";

  const lookbackDateAfterPresentOrExperiment =
    lookbackOverride?.type === "date"
      ? lookbackOverride.value > endDate
      : false;
  const handleModeChange = (v: string) => {
    if (!v) return;
    if (v === "metric") {
      onAttributionModelChange("firstExposure");
      onLookbackOverrideChange(undefined);
    } else if (v === "ignore") {
      onAttributionModelChange("experimentDuration");
      onLookbackOverrideChange(undefined);
    } else {
      onAttributionModelChange("lookbackOverride");
      onLookbackOverrideChange({
        type: "date",
        value: new Date(
          endDate.getTime() -
            DEFAULT_LOOKBACK_OVERRIDE_VALUE_DAYS * 24 * 60 * 60 * 1000,
        ),
      });
    }
  };

  return (
    <Box mb="2">
      <Flex direction="column">
        <Box>
          <SelectField
            label={
              <AttributionModelTooltip>
                Metric Analysis Windows <GBInfo />
              </AttributionModelTooltip>
            }
            labelClassName="font-weight-bold"
            value={mode}
            onChange={handleModeChange}
            options={[
              { label: "Respect Metric Settings", value: "metric" },
              { label: "Ignore Conversion Windows", value: "ignore" },
              { label: "Use Custom Lookback Window", value: "custom" },
            ]}
            sort={false}
            disabled={disabled}
            helpText="Apply custom metric window behavior in this experiment."
          />
        </Box>
        {mode === "custom" && lookbackOverride && (
          <Box className="appbox bg-light p-3">
            <Box mb="2">
              <RadioGroup
                value={lookbackOverride.type}
                setValue={(v) => {
                  if (v === "date") {
                    onLookbackOverrideChange({
                      type: "date",
                      value: new Date(
                        endDate.getTime() -
                          DEFAULT_LOOKBACK_OVERRIDE_VALUE_DAYS *
                            24 *
                            60 *
                            60 *
                            1000,
                      ),
                    });
                  } else if (v === "window") {
                    onLookbackOverrideChange({
                      type: "window",
                      value: DEFAULT_LOOKBACK_OVERRIDE_VALUE_DAYS,
                      valueUnit: DEFAULT_LOOKBACK_OVERRIDE_VALUE_UNIT,
                    });
                  }
                }}
                options={[
                  { label: "Fixed Date", value: "date" },
                  { label: "Lookback Window", value: "window" },
                ]}
                disabled={disabled}
              />
            </Box>

            <Flex direction="row" gap="2" align="center">
              {lookbackOverride.type === "date" && (
                <>
                  <Box>Only use metric data from</Box>
                  <DatePicker
                    date={lookbackOverride.value}
                    containerClassName={""}
                    setDate={(d) => {
                      if (d) {
                        onLookbackOverrideChange({ type: "date", value: d });
                      }
                    }}
                  />
                  <Box>until the end of the experiment</Box>
                </>
              )}
              {lookbackOverride.type === "window" && (
                <>
                  <Box>Use only the latest</Box>
                  <Field
                    type="number"
                    style={{ width: 70 }}
                    min={0}
                    step={0.01}
                    value={
                      localWindowValue !== null
                        ? localWindowValue
                        : (lookbackOverride.value ?? "")
                    }
                    onChange={(e) => {
                      setLocalWindowValue(e.target.value ?? "");
                    }}
                    onBlur={() => {
                      if (localWindowValue === null) return;
                      const v = parseFloat(localWindowValue);
                      if (localWindowValue === "" || isNaN(v) || v < 0) {
                        onLookbackOverrideChange({
                          ...lookbackOverride,
                          value: 14,
                        });
                      } else {
                        onLookbackOverrideChange({
                          ...lookbackOverride,
                          value: v,
                        });
                      }
                      setLocalWindowValue(null);
                    }}
                    disabled={disabled}
                  />
                  <SelectField
                    value={
                      lookbackOverride.valueUnit ??
                      DEFAULT_LOOKBACK_OVERRIDE_VALUE_UNIT
                    }
                    onChange={(v) => {
                      onLookbackOverrideChange({
                        ...lookbackOverride,
                        valueUnit: v as LookbackOverrideValueUnit,
                      });
                    }}
                    options={[
                      { label: "Minutes", value: "minutes" },
                      { label: "Hours", value: "hours" },
                      { label: "Days", value: "days" },
                      { label: "Weeks", value: "weeks" },
                    ]}
                    disabled={disabled}
                  />
                  <Box>of data until the end of the experiment</Box>
                </>
              )}
            </Flex>
            {lookbackDateAfterPresentOrExperiment && (
              <HelperText status="warning" size="md">
                Lookback date is later than the present or the end of the
                experiment
              </HelperText>
            )}
          </Box>
        )}
      </Flex>
      {helpText}
    </Box>
  );
};

export default MetricAnalysisWindowSelector;

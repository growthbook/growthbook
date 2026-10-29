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
  /** Without its own label and description, for a row that labels it. */
  bare?: boolean;
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
  bare = false,
}) => {
  const endDate = analysisEndDate ?? phaseEndDate ?? new Date();
  const [localWindowValue, setLocalWindowValue] = useState<string | null>(null);

  const lookbackDateAfterPresentOrExperiment =
    lookbackOverride?.type === "date"
      ? lookbackOverride.value > endDate
      : false;
  const handleModeChange = (next: string) => {
    if (next === attributionModel) return;
    if (!next) return;
    if (next === "firstExposure") {
      onAttributionModelChange("firstExposure");
      onLookbackOverrideChange(undefined);
    } else if (next === "experimentDuration") {
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
    <Box mb={bare ? "0" : "2"}>
      <Flex direction="column">
        <Box>
          <SelectField
            size="legacy"
            label={
              bare ? undefined : (
                <AttributionModelTooltip>
                  Metric Analysis Windows <GBInfo />
                </AttributionModelTooltip>
              )
            }
            labelClassName="font-weight-bold"
            value={attributionModel}
            onChange={handleModeChange}
            options={[
              { label: "Respect metric settings", value: "firstExposure" },
              {
                label: "Ignore conversion windows",
                value: "experimentDuration",
              },
              {
                label: "Use custom lookback window",
                value: "lookbackOverride",
              },
            ]}
            sort={false}
            disabled={disabled}
            helpText={
              bare
                ? undefined
                : "Apply custom metric window behavior in this experiment."
            }
          />
        </Box>
        {attributionModel === "lookbackOverride" && lookbackOverride && (
          <Box mt="3">
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
              gap="2"
              options={[
                {
                  value: "date",
                  label: "Fixed date",
                  description:
                    "Only use metric data from this date until the end of the experiment.",
                  renderOutsideItem: true,
                  renderOnSelect:
                    lookbackOverride.type === "date" ? (
                      <Box pl="5">
                        <DatePicker
                          date={lookbackOverride.value}
                          timeZone="utc"
                          containerClassName="mb-0"
                          disabled={disabled}
                          setDate={(d) => {
                            if (d) {
                              onLookbackOverrideChange({
                                type: "date",
                                value: d,
                              });
                            }
                          }}
                        />
                      </Box>
                    ) : undefined,
                },
                {
                  value: "window",
                  label: "Lookback window",
                  description:
                    "Only use the latest metric data until the end of the experiment.",
                  renderOutsideItem: true,
                  renderOnSelect:
                    lookbackOverride.type === "window" ? (
                      <Flex pl="5" gap="2" align="center">
                        <Field
                          size="legacy"
                          type="number"
                          style={{ width: 70 }}
                          containerClassName="mb-0"
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
                          aria-label="Lookback window length"
                        />
                        <SelectField
                          aria-label="Lookback window unit"
                          size="legacy"
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
                          containerClassName="mb-0"
                          options={[
                            { label: "Minutes", value: "minutes" },
                            { label: "Hours", value: "hours" },
                            { label: "Days", value: "days" },
                            { label: "Weeks", value: "weeks" },
                          ]}
                          disabled={disabled}
                        />
                      </Flex>
                    ) : undefined,
                },
              ]}
              disabled={disabled}
            />
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

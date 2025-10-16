import { useFormContext } from "react-hook-form";
import { Box, Flex, Heading, Text } from "@radix-ui/themes";
import React from "react";
import { DEFAULT_MAX_METRIC_SLICE_LEVELS } from "shared/settings";
import { hasFileConfig } from "@/services/env";
import { supportedCurrencies } from "@/services/settings";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import Callout from "@/ui/Callout";
import Frame from "@/ui/Frame";
import Checkbox from "@/ui/Checkbox";
import { useUser } from "@/services/UserContext";
import PaidFeatureBadge from "@/components/GetStarted/PaidFeatureBadge";

export default function MetricsSettings() {
  const form = useFormContext();
  const { hasCommercialFeature } = useUser();
  const metricAnalysisDays = form.watch("metricAnalysisDays");
  const metricAnalysisDaysWarningMsg =
    metricAnalysisDays && metricAnalysisDays > 365
      ? "Using more historical data will slow down metric analysis queries"
      : "";
  const maxMetricSliceLevels = form.watch("maxMetricSliceLevels");
  const maxMetricSliceLevelsWarningMsg =
    maxMetricSliceLevels && maxMetricSliceLevels > 20
      ? "Using too many slice levels may increase query costs substantially. All auto slice levels are analyzed every time an experiment refreshes."
      : "";
  const currencyOptions = Object.entries(supportedCurrencies).map(
    ([value, label]) => ({ value, label }),
  );
  return (
    <Frame>
      <Flex gap="4">
        <Box width="220px" flexShrink="0">
          <Heading size="4" as="h4">
            Metric Settings
          </Heading>
        </Box>

        <Flex align="start" direction="column" flexGrow="1" pt="6">
          <Box mb="6" width="100%">
            <Text as="label" className="font-weight-semibold" size="3">
              Amount of historical data to use on metric analysis page
            </Text>
            <Box width="200px">
              <Field
                type="number"
                append="days"
                containerClassName="mb-0"
                disabled={hasFileConfig()}
                {...form.register("metricAnalysisDays", {
                  valueAsNumber: true,
                })}
              />
            </Box>
            {metricAnalysisDaysWarningMsg && (
              <Callout status="warning" mt="2">
                {metricAnalysisDaysWarningMsg}
              </Callout>
            )}
          </Box>

          {/* region Metrics Behavior Defaults */}
          <Box mb="4" width="100%">
            <Heading as="h4" size="4">
              Metrics Behavior Defaults
            </Heading>
            <p>
              These are the pre-configured default values that will be used when
              configuring metrics. You can always change these values on a
              per-metric basis.
            </p>

            {/* region Minimum Metric Total */}
            <div>
              <div className="form-inline">
                <Field
                  label="Minimum Metric Total"
                  type="number"
                  min={0}
                  className="ml-2"
                  containerClassName="mt-2"
                  disabled={hasFileConfig()}
                  {...form.register("metricDefaults.minimumSampleSize", {
                    valueAsNumber: true,
                    min: 0,
                  })}
                />
              </div>
              <p>
                <small className="text-muted mb-3">
                  The total metric value required in an experiment variation
                  before showing results
                </small>
              </p>
            </div>
            {/* endregion Minimum Metric Total */}

            {/* region Maximum Percentage Change */}
            <div>
              <div className="form-inline">
                <Field
                  label="Maximum Percentage Change"
                  type="number"
                  min={0}
                  append="%"
                  className="ml-2"
                  containerClassName="mt-2"
                  disabled={hasFileConfig()}
                  {...form.register("metricDefaults.maxPercentageChange", {
                    valueAsNumber: true,
                    min: 0,
                  })}
                />
              </div>
              <p>
                <small className="text-muted mb-3">
                  An experiment that changes the metric by more than this
                  percent will be flagged as suspicious
                </small>
              </p>
            </div>
            {/* endregion Maximum Percentage Change */}

            {/* region Minimum Percentage Change */}
            <div>
              <div className="form-inline">
                <Field
                  label="Minimum Percentage Change"
                  type="number"
                  min={0}
                  append="%"
                  className="ml-2"
                  containerClassName="mt-2"
                  disabled={hasFileConfig()}
                  {...form.register("metricDefaults.minPercentageChange", {
                    valueAsNumber: true,
                    min: 0,
                  })}
                />
              </div>
              <p>
                <small className="text-muted mb-3">
                  An experiment that changes the metric by less than this
                  percent percent will be considered a draw
                </small>
              </p>
            </div>
            {/* endregion Minimum Percentage Change */}

            {/* region Target MDE */}
            <div>
              <div className="form-inline">
                <Field
                  label="Target Minimum Detectable Effect"
                  type="number"
                  min={0}
                  append="%"
                  className="ml-2"
                  containerClassName="mt-2"
                  disabled={hasFileConfig()}
                  {...form.register("metricDefaults.targetMDE", {
                    valueAsNumber: true,
                    min: 0,
                  })}
                />
              </div>
              <p>
                <small className="text-muted mb-3">
                  The percentage change that you want to be able to reliably
                  detect before ending your experiment. This is used to estimate
                  the &quot;Days Left&quot; for running experiments.
                  <br />
                  Lower values require more data to reach a decision point for
                  an experiment.
                </small>
              </p>
            </div>
            {/* endregion Target MDE */}
          </Box>
          {/* endregion Metrics Behavior Defaults */}
          <>
            <SelectField
              label="Display Currency"
              value={form.watch("displayCurrency") || "USD"}
              options={currencyOptions}
              onChange={(v: string) => form.setValue("displayCurrency", v)}
              required
              placeholder="Select currency..."
              helpText="This should match what is stored in the data source and controls what currency symbol is displayed."
            />
          </>

          {/* Require Fact Metrics */}
          <Box mt="3" mb="6" width="100%">
            <Flex align="start" justify="start" gap="3">
              <Box>
                <Checkbox
                  id="toggle-disableLegacyMetricCreation"
                  value={!!form.watch("disableLegacyMetricCreation")}
                  setValue={(value) => {
                    form.setValue("disableLegacyMetricCreation", value);
                  }}
                  mt="1"
                />
              </Box>
              <Flex
                direction="column"
                justify="start"
                style={{ marginTop: "1px" }}
              >
                <Box>
                  <Text
                    size="3"
                    className="font-weight-semibold"
                    htmlFor="toggle-disableLegacyMetricCreation"
                    as="label"
                    mb="2"
                  >
                    Require Fact Metrics
                  </Text>
                </Box>
                <Box>
                  <Text size="2" color="gray">
                    If enabled, users will only be able to create Fact Metrics.
                    Legacy metric creation will be disabled.
                  </Text>
                </Box>
              </Flex>
            </Flex>
          </Box>

          <Box mb="6" width="100%" mt="2">
            <Heading as="h4" size="4" mb="3">
              Metric Slices
            </Heading>
            <Text as="label" className="font-weight-semibold" size="3">
              Max auto slice levels
              <PaidFeatureBadge
                commercialFeature="metric-slices"
                premiumText="This is an Enterprise feature"
                variant="outline"
                ml="2"
              />
            </Text>
            <Box mb="3">
              {hasCommercialFeature("metric-slices")
                ? `Maximum number of slice levels that can be configured for metric analysis. Default is ${DEFAULT_MAX_METRIC_SLICE_LEVELS}.`
                : "This feature requires an Enterprise license."}
            </Box>
            <Box width="200px">
              <Field
                type="number"
                min="0"
                max="200"
                step="1"
                disabled={
                  hasFileConfig() || !hasCommercialFeature("metric-slices")
                }
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
          </Box>
        </Flex>
      </Flex>
    </Frame>
  );
}

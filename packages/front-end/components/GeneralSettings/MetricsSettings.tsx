import { useFormContext } from "react-hook-form";
import { Box, Flex, Heading, Text } from "@radix-ui/themes";
import React from "react";
import { hasFileConfig } from "@/services/env";
import { supportedCurrencies } from "@/services/settings";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import Callout from "@/components/Radix/Callout";
import Frame from "@/components/Radix/Frame";

export default function MetricsSettings() {
  const form = useFormContext();
  const metricAnalysisDays = form.watch("metricAnalysisDays");
  const metricAnalysisDaysWarningMsg =
    metricAnalysisDays && metricAnalysisDays > 365
      ? "Using more historical data will slow down metric analysis queries"
      : "";
  const currencyOptions = Object.entries(supportedCurrencies).map(
    ([value, label]) => ({ value, label })
  );
  return (
    <Frame>
      <Flex gap="4">
        <Box width="220px" flexShrink="0">
          <Heading size="4" as="h4">
            Metrics Settings
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
        </Flex>
      </Flex>
    </Frame>
  );
}

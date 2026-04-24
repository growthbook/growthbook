import React, { useState } from "react";
import { useFormContext } from "react-hook-form";
import { Box, Flex, Heading, Text } from "@radix-ui/themes";
import Checkbox from "@/ui/Checkbox";
import { hasFileConfig } from "@/services/env";
import { useUser } from "@/services/UserContext";
import Button from "@/ui/Button";
import Field from "@/components/Forms/Field";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { AttributionModelTooltip } from "@/components/Experiment/AttributionModelTooltip";
import ExperimentCheckListModal from "@/components/Settings/ExperimentCheckListModal";
import RadioGroup from "@/ui/RadioGroup";
import { GBInfo } from "@/components/Icons";
import Frame from "@/ui/Frame";
import StatsEngineSettings from "./StatsEngineSettings";
import StickyBucketingSettings from "./StickyBucketingSettings";
import DecisionFrameworkSettings from "./DecisionFrameworkSettings";

export default function ExperimentSettings({
  cronString,
  updateCronString,
}: {
  cronString: string;
  updateCronString: (value: string) => void;
}) {
  const { hasCommercialFeature } = useUser();
  const form = useFormContext();

  const queryParams = new URLSearchParams(window.location.search);

  const [editChecklistOpen, setEditChecklistOpen] = useState(
    () => queryParams.get("editCheckListModal") || false,
  );

  const srmThreshold = form.watch("srmThreshold");
  const srmHighlightColor =
    srmThreshold && (srmThreshold > 0.01 || srmThreshold < 0.001)
      ? "#B39F01"
      : "";
  const srmWarningMsg =
    srmThreshold && srmThreshold > 0.01
      ? "Thresholds above 0.01 may lead to many false positives, especially if you refresh results regularly."
      : srmThreshold && srmThreshold < 0.001
        ? "Thresholds below 0.001 may make it hard to detect imbalances without lots of traffic."
        : "";

  return (
    <>
      <Frame>
        <Flex gap="4">
          <Box width="220px" flexShrink="0" id="experiment-settings">
            <Heading size="4" as="h4">
              Experiment Settings
            </Heading>
          </Box>

          <Flex align="start" direction="column" flexGrow="1" pt="6">
            {/* Custom checklists */}
            <Box mb="6">
              <PremiumTooltip
                commercialFeature="custom-launch-checklist"
                premiumText="Custom pre-launch checklists are available to Enterprise customers"
              >
                <Text size="3" className="font-weight-semibold">
                  Experiment Pre-Launch Checklist
                </Text>
              </PremiumTooltip>
              <p className="pt-2">
                Configure required steps that need to be completed before an
                experiment can be launched.
              </p>
              <Button
                variant="soft"
                disabled={!hasCommercialFeature("custom-launch-checklist")}
                onClick={async () => {
                  setEditChecklistOpen(true);
                }}
              >
                Edit Checklist
              </Button>
            </Box>

            {/* Require experiment templates */}
            <Box mb="6">
              <Flex align="start" gap="3">
                <Box>
                  <Checkbox
                    disabled={!hasCommercialFeature("templates")}
                    value={
                      hasCommercialFeature("templates") &&
                      form.watch("requireExperimentTemplates")
                    }
                    setValue={(v) =>
                      form.setValue("requireExperimentTemplates", v)
                    }
                    id="toggle-requireExperimentTemplates"
                    mt="1"
                  />
                </Box>
                <Flex direction="column">
                  <Text size="3" className="font-weight-semibold">
                    <label htmlFor="toggle-requireExperimentTemplates">
                      Require Experiment Templates
                    </label>
                  </Text>
                  <Text>
                    Require users to select a template when creating a new
                    experiment.
                  </Text>
                </Flex>
              </Flex>
            </Box>

            {/* import length */}
            <Box mb="6">
              <Flex mb="2">
                <label>
                  <Text size="3" className="font-weight-semibold">
                    Minimum experiment length when importing past experiments
                  </Text>
                </label>
              </Flex>
              <Box width="150px">
                <Field
                  type="number"
                  append="days"
                  step="1"
                  min="0"
                  max="31"
                  disabled={hasFileConfig()}
                  {...form.register("pastExperimentsMinLength", {
                    valueAsNumber: true,
                    min: 0,
                    max: 31,
                  })}
                />
              </Box>
            </Box>

            {/* Fact table optimization */}
            <Box mb="6">
              <Flex align="start" justify="start" gap="3">
                <Box>
                  <Checkbox
                    disabled={!hasCommercialFeature("multi-metric-queries")}
                    value={
                      hasCommercialFeature("multi-metric-queries") &&
                      !form.watch("disableMultiMetricQueries")
                    }
                    setValue={(v) =>
                      form.setValue("disableMultiMetricQueries", !v)
                    }
                    id="toggle-factoptimization"
                    mt="1"
                  />
                </Box>
                <Flex direction="column" justify="start">
                  <Box>
                    <label
                      htmlFor="toggle-factTableQueryOptimization"
                      className="mb-2"
                    >
                      <PremiumTooltip
                        commercialFeature="multi-metric-queries"
                        body={
                          <>
                            <p>
                              If multiple metrics from the same Fact Table are
                              added to an experiment, this will combine them
                              into a single query, which is much faster and more
                              efficient.
                            </p>
                            <p>
                              For data sources with usage-based billing like
                              BigQuery or SnowFlake, this can result in
                              substantial cost savings.
                            </p>
                          </>
                        }
                      >
                        <Text size="3" className="font-weight-semibold">
                          Fact Table Query Optimization
                        </Text>{" "}
                        <GBInfo />
                      </PremiumTooltip>
                    </label>
                  </Box>
                  <Box>
                    <Text>
                      Combine multiple metrics from the same Fact Table into a
                      single query to reduce fees on usage-based data sources,
                      like BigQuery or Snowflake.
                    </Text>
                  </Box>
                </Flex>
              </Flex>
            </Box>

            {/* Pre-computed dimension breakdowns */}
            <Box mb="6">
              <Flex align="start" justify="start" gap="3">
                <Box>
                  <Checkbox
                    disabled={!hasCommercialFeature("precomputed-dimensions")}
                    value={
                      hasCommercialFeature("precomputed-dimensions") &&
                      !form.watch("disablePrecomputedDimensions")
                    }
                    setValue={(v) =>
                      form.setValue("disablePrecomputedDimensions", !v)
                    }
                    id="toggle-precomputed-dimensions"
                    mt="1"
                  />
                </Box>
                <Flex direction="column" justify="start">
                  <Box>
                    <label
                      htmlFor="toggle-precomputed-dimensions"
                      className="mb-2"
                    >
                      <PremiumTooltip
                        commercialFeature="precomputed-dimensions"
                        body={
                          <>
                            <p>
                              If your exposure queries have dimension columns,
                              this will pre-compute the breakdowns for those
                              dimensions for faster slicing-and-dicing in
                              experiments.
                            </p>
                            <p>
                              This setting will also enable post-stratification,
                              a forthcoming variance reduction technique.
                            </p>
                          </>
                        }
                      >
                        <Text size="3" className="font-weight-semibold">
                          Pre-computed Dimension Breakdowns
                        </Text>{" "}
                        <GBInfo />
                      </PremiumTooltip>
                    </label>
                  </Box>
                  <Box>
                    <Text>
                      Pre-compute dimension breakdowns using dimension columns
                      in your exposure queries (does not pre-compute dimension
                      breakdowns for standalone unit dimensions). This enables
                      faster dimension slicing-and-dicing without additional
                      queries or joins at the cost of more aggregation steps in
                      the main analysis queries. Navigate to your Data Source
                      page to configure the dimension slices.
                    </Text>
                  </Box>
                </Flex>
              </Flex>
            </Box>

            {/* Conversion window override */}
            <Box mb="4" width="100%">
              <Box className="appbox p-3">
                <Box>
                  <Flex>
                    <AttributionModelTooltip>
                      <Flex gap="2" align="center" mb="4" justify="start">
                        <Text size="3" className="font-weight-semibold">
                          Default Conversion Window Override
                        </Text>{" "}
                        <GBInfo />
                      </Flex>
                    </AttributionModelTooltip>
                  </Flex>
                  <RadioGroup
                    options={[
                      {
                        label: "Respect Conversion Windows",
                        value: "firstExposure",
                        description:
                          "For metrics with conversion windows, build a single conversion window off of each user's first exposure.",
                      },
                      {
                        label: "Ignore Conversion Windows",
                        value: "experimentDuration",
                        description:
                          "Count all metric values from user's first exposure to the end of the experiment.",
                      },
                    ]}
                    value={form.watch("attributionModel")}
                    gap="2"
                    descriptionSize="2"
                    setValue={(v) => {
                      form.setValue("attributionModel", v);
                    }}
                  />
                </Box>
              </Box>
            </Box>

            {/* Experiment Auto-Update Frequency */}
            <Box mb="4" width="100%">
              <Box className="appbox p-3">
                <Heading size="3" className="font-weight-semibold" mb="4">
                  Experiment auto-update frequency
                </Heading>
                <RadioGroup
                  disabled={hasFileConfig()}
                  options={[
                    {
                      label: "Refresh results after a specified duration",
                      value: "stale",
                      description: (
                        <Field
                          label="Refresh when"
                          append="hours old"
                          type="number"
                          style={{ width: "180px" }}
                          step={1}
                          min={1}
                          max={168}
                          disabled={
                            hasFileConfig() ||
                            form.watch("updateSchedule.type") !== "stale"
                          }
                          {...form.register("updateSchedule.hours")}
                        />
                      ),
                    },
                    {
                      label: "Cron Schedule",
                      value: "cron",
                      description: (
                        <>
                          <Text mb="2" as="p">
                            Enter cron string to specify frequency. Minimum once
                            an hour.
                          </Text>
                          <Field
                            disabled={
                              hasFileConfig() ||
                              form.watch("updateSchedule.type") !== "cron"
                            }
                            {...form.register("updateSchedule.cron")}
                            placeholder="0 */6 * * *"
                            onFocus={(e) => {
                              updateCronString(e.target.value);
                            }}
                            onBlur={(e) => {
                              updateCronString(e.target.value);
                            }}
                            helpText={
                              <span className="ml-2">{cronString}</span>
                            }
                          />
                        </>
                      ),
                    },
                    {
                      label: "Never",
                      value: "never",
                      description:
                        "Results will not refresh automatically, but can be updated manually",
                    },
                  ]}
                  gap="2"
                  descriptionSize="2"
                  value={form.watch("updateSchedule.type")}
                  setValue={(v) => {
                    form.setValue("updateSchedule.type", v);
                  }}
                />
              </Box>
            </Box>

            {/* Sticky Bucketing */}
            <Box mb="4" width="100%">
              <Box className="appbox p-3">
                <StickyBucketingSettings />
              </Box>
            </Box>

            {/* Experiment Health Settings */}
            <Box mb="4" width="100%">
              <Box className="appbox p-3">
                <Heading size="3" className="font-weight-semibold" mb="4">
                  Experiment Health Settings
                </Heading>

                <Flex align="start" gap="3" mb="4">
                  <Checkbox
                    value={form.watch("runHealthTrafficQuery")}
                    setValue={(v) => form.setValue("runHealthTrafficQuery", v)}
                    id="toggle-factoptimization"
                  />
                  <Box>
                    <label
                      htmlFor="toggle-runHealthTrafficQuery"
                      className="font-weight-semibold mb-3"
                    >
                      Run traffic query by default
                    </label>
                  </Box>
                </Flex>

                <Box mb="4">
                  <Text className="font-weight-semibold">
                    SRM p-value threshold
                  </Text>
                  <Box
                    mt="1"
                    className="form-inline flex-column align-items-start"
                  >
                    <Field
                      type="number"
                      step="0.001"
                      style={{
                        borderColor: srmHighlightColor,
                        backgroundColor: srmHighlightColor
                          ? srmHighlightColor + "15"
                          : "",
                      }}
                      max="0.1"
                      min="0.00001"
                      containerClassName="mb-3"
                      append=""
                      disabled={hasFileConfig()}
                      helpText={
                        <>
                          <span className="ml-2">(0.001 is default)</span>
                          <div
                            className="ml-2"
                            style={{
                              color: srmHighlightColor,
                              flexBasis: "100%",
                            }}
                          >
                            {srmWarningMsg}
                          </div>
                        </>
                      }
                      {...form.register("srmThreshold", {
                        valueAsNumber: true,
                        min: 0,
                        max: 1,
                      })}
                    />
                  </Box>
                </Box>
                <Box>
                  <Text className="font-weight-semibold" size="2">
                    <label>
                      Warn when this percent of experiment users are in multiple
                      variations
                    </label>
                  </Text>
                  <Flex>
                    <Field
                      type="number"
                      step="1"
                      min="0"
                      max="100"
                      containerClassName="mb-3"
                      append="%"
                      style={{
                        width: "62px",
                      }}
                      disabled={hasFileConfig()}
                      {...form.register("multipleExposureMinPercent", {
                        valueAsNumber: true,
                        min: 0,
                        max: 100,
                      })}
                    />
                  </Flex>
                </Box>
              </Box>
            </Box>

            {/* Decision Framework Settings */}
            <Box mb="4" width="100%">
              <DecisionFrameworkSettings />
            </Box>
          </Flex>
        </Flex>
      </Frame>

      <Frame>
        <Flex gap="4">
          <Box width="220px" flexShrink="0">
            <Heading size="4" as="h4">
              Experiment Analysis
            </Heading>
          </Box>

          <Flex align="start" direction="column" flexGrow="1" pt="6">
            <StatsEngineSettings />
          </Flex>
        </Flex>
        {editChecklistOpen ? (
          <ExperimentCheckListModal close={() => setEditChecklistOpen(false)} />
        ) : null}
      </Frame>
    </>
  );
}

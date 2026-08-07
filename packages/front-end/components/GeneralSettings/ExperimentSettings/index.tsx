import React, { useState } from "react";
import { useFormContext } from "react-hook-form";
import { Box, Flex, Heading, Text } from "@radix-ui/themes";
import {
  DEFAULT_MULTIPLE_EXPOSURES_THRESHOLD,
  DEFAULT_NO_DATA_ALERT_GRACE_PERIOD_HOURS,
  DEFAULT_SRM_THRESHOLD,
} from "shared/constants";
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
import HelperText from "@/ui/HelperText";
import TextField from "@/ui/TextField";
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

  // HTML min/max only constrain the stepper arrows, not typed values. These
  // rules block save on out-of-range values; render the message via `error`.
  // A cleared field is NaN, which passes min/max and falls back to the
  // default on save.
  const registerBoundedNumber = (name: string, min: number, max: number) =>
    form.register(name, {
      valueAsNumber: true,
      min: { value: min, message: `Must be between ${min} and ${max}` },
      max: { value: max, message: `Must be between ${min} and ${max}` },
    });

  const fieldErrorMessage = (name: string): string | undefined => {
    const message = form.formState.errors[name]?.message;
    return typeof message === "string" && message ? message : undefined;
  };

  const srmThreshold = form.watch("srmThreshold");
  const srmWarningMsg =
    srmThreshold && srmThreshold > 0.01
      ? "Thresholds above 0.01 may lead to many false positives, especially if you refresh results regularly. Our default is 0.001."
      : srmThreshold && srmThreshold < 0.001
        ? "Thresholds below 0.001 may make it hard to detect imbalances without lots of traffic. Our default is 0.001."
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
                  Experiment pre-launch checklist
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
                Edit checklist
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

            {/* Require unique experiment keys */}
            <Box mb="6">
              <Flex align="start" gap="3">
                <Box>
                  <Checkbox
                    value={form.watch("requireUniqueExperimentTrackingKeys")}
                    setValue={(v) =>
                      form.setValue("requireUniqueExperimentTrackingKeys", v)
                    }
                    id="toggle-requireUniqueExperimentTrackingKeys"
                    mt="1"
                  />
                </Box>
                <Flex direction="column">
                  <Text size="3" className="font-weight-semibold">
                    <label htmlFor="toggle-requireUniqueExperimentTrackingKeys">
                      Require unique experiment keys
                    </label>
                  </Text>
                  <Text>
                    Prevent experimenters from setting an experiment tracking
                    key to one already in use.
                  </Text>
                </Flex>
              </Flex>
            </Box>

            {/* import length */}
            <Box mb="6">
              <Flex mb="2">
                <label>
                  <Text size="3" className="font-weight-semibold">
                    Minimum length for imported experiments
                  </Text>
                </label>
              </Flex>
              <Box width="150px">
                <Field
                  size="legacy"
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
              <HelperText status="info" size="sm" mt="1">
                When importing past experiments from a Data Source, GrowthBook
                skips any that ran for fewer than this many days.
              </HelperText>
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
                          Pre-computed dimension breakdowns
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
                          Default conversion window override
                        </Text>{" "}
                        <GBInfo />
                      </Flex>
                    </AttributionModelTooltip>
                  </Flex>
                  <RadioGroup
                    options={[
                      {
                        label: "Respect conversion windows",
                        value: "firstExposure",
                        description:
                          "For metrics with conversion windows, build a single conversion window off of each user's first exposure.",
                      },
                      {
                        label: "Ignore conversion windows",
                        value: "experimentDuration",
                        description:
                          "Count all metric values from user's first exposure to the end of the experiment.",
                      },
                    ]}
                    value={form.watch("attributionModel")}
                    gap="2"
                    descriptionSize="md"
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
                  Experiment Auto-Update Frequency
                </Heading>
                <RadioGroup
                  disabled={hasFileConfig()}
                  options={[
                    {
                      label: "Refresh results after a specified duration",
                      value: "stale",
                      description: (
                        <Field
                          size="legacy"
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
                            size="legacy"
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
                  descriptionSize="md"
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

                <Flex align="start" gap="3" mb="4" direction="column">
                  <Checkbox
                    id="toggle-runHealthTrafficQuery"
                    label="Run traffic query by default"
                    value={!!form.watch("runHealthTrafficQuery")}
                    setValue={(v) => form.setValue("runHealthTrafficQuery", v)}
                  />

                  <TextField
                    label="SRM p-value threshold"
                    type="number"
                    step={0.001}
                    min={0.00001}
                    max={0.1}
                    disabled={hasFileConfig()}
                    style={{ width: 150 }}
                    placeholder={String(DEFAULT_SRM_THRESHOLD)}
                    helpText={`Default is ${DEFAULT_SRM_THRESHOLD}.`}
                    error={
                      fieldErrorMessage("srmThreshold") ??
                      (srmWarningMsg || undefined)
                    }
                    errorLevel={
                      fieldErrorMessage("srmThreshold") ? "error" : "warning"
                    }
                    {...registerBoundedNumber("srmThreshold", 0.00001, 0.1)}
                  />

                  <TextField
                    label="Multiple exposures warning threshold"
                    type="number"
                    step={1}
                    min={0}
                    max={100}
                    append="%"
                    disabled={hasFileConfig()}
                    style={{ width: 90 }}
                    placeholder={String(
                      DEFAULT_MULTIPLE_EXPOSURES_THRESHOLD * 100,
                    )}
                    helpText={`Warn when at least this percent of experiment users are in multiple variations. Default is ${DEFAULT_MULTIPLE_EXPOSURES_THRESHOLD * 100}%.`}
                    error={fieldErrorMessage("multipleExposureMinPercent")}
                    {...registerBoundedNumber(
                      "multipleExposureMinPercent",
                      0,
                      100,
                    )}
                  />

                  <TextField
                    label="No data grace period"
                    type="number"
                    step={1}
                    min={0}
                    max={168}
                    append="hours"
                    disabled={hasFileConfig()}
                    style={{ width: 150 }}
                    placeholder={String(
                      DEFAULT_NO_DATA_ALERT_GRACE_PERIOD_HOURS,
                    )}
                    helpText={`Wait this long after an experiment starts before showing the "no data" status badge or sending alerts when an experiment updates. Default is ${DEFAULT_NO_DATA_ALERT_GRACE_PERIOD_HOURS} hours.`}
                    error={fieldErrorMessage("noDataAlertGracePeriodHours")}
                    {...registerBoundedNumber(
                      "noDataAlertGracePeriodHours",
                      0,
                      168,
                    )}
                  />
                </Flex>
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

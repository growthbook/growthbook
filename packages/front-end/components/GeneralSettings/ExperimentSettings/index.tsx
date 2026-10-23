import React, { useState } from "react";
import { useFormContext } from "react-hook-form";
import { Box } from "@radix-ui/themes";
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
import HelperText from "@/ui/HelperText";
import Text from "@/ui/Text";
import {
  SettingsField,
  SettingsGroup,
} from "@/components/GeneralSettings/SettingsGroup";
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

  const requireKeyExample = !!form.watch("experimentKeyRegexValidator");
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
      <SettingsGroup
        id="exp-launch"
        title="Launch requirements"
        description="What experimenters must do before an experiment can launch."
        keywords="pre-launch checklist template tracking key regex naming duplicate"
      >
        <SettingsField
          label={
            <PremiumTooltip
              commercialFeature="custom-launch-checklist"
              premiumText="Custom pre-launch checklists are available to Enterprise customers"
            >
              Pre-launch checklist
            </PremiumTooltip>
          }
          help="Steps that must be completed before an experiment can launch."
        >
          <Button
            variant="soft"
            disabled={!hasCommercialFeature("custom-launch-checklist")}
            onClick={async () => {
              setEditChecklistOpen(true);
            }}
          >
            Edit checklist
          </Button>
        </SettingsField>

        <Checkbox
          id="toggle-requireExperimentTemplates"
          label="Require experiment templates"
          description="New experiments must start from a template."
          disabled={!hasCommercialFeature("templates")}
          value={
            hasCommercialFeature("templates") &&
            form.watch("requireExperimentTemplates")
          }
          setValue={(v) => form.setValue("requireExperimentTemplates", v)}
        />

        <Checkbox
          id="toggle-requireUniqueExperimentTrackingKeys"
          label="Require unique experiment keys"
          description="Block tracking keys that are already used by another experiment."
          value={form.watch("requireUniqueExperimentTrackingKeys")}
          setValue={(v) =>
            form.setValue("requireUniqueExperimentTrackingKeys", v)
          }
        />

        <SettingsField
          htmlFor="experimentKeyRegexValidator"
          label="Experiment key format (regex)"
          help="Tracking keys set in the app or API must match this pattern. Holdout keys and keys discovered in a Data Source are exempt."
        >
          <Field
            id="experimentKeyRegexValidator"
            containerClassName="mb-0"
            {...form.register("experimentKeyRegexValidator")}
            placeholder="^exp-\d{8}-.+$"
          />
        </SettingsField>

        <SettingsField
          htmlFor="experimentKeyExample"
          label={
            <>
              Experiment key example
              {requireKeyExample && (
                <Text color="text-high" ml="1">
                  *
                </Text>
              )}
            </>
          }
          help="Shown when creating an experiment. Required when a key format is set, and must match it."
        >
          <Field
            id="experimentKeyExample"
            containerClassName="mb-0"
            required={requireKeyExample}
            {...form.register("experimentKeyExample")}
            placeholder="exp-20260101-checkout-cta"
          />
        </SettingsField>
      </SettingsGroup>

      <SettingsGroup
        id="exp-results"
        title="Results & refresh"
        description="How often results update and how they're computed."
        keywords="auto-update refresh schedule cron conversion window attribution dimensions slices import past experiments"
      >
        <SettingsField label="Auto-update frequency">
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
                label: "Cron schedule",
                value: "cron",
                description: (
                  <>
                    <Text as="p" mb="2">
                      Enter a cron string to set the frequency. Runs in UTC.
                      Minimum once an hour.
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
                      helpText={<span className="ml-2">{cronString}</span>}
                    />
                  </>
                ),
              },
              {
                label: "Never",
                value: "never",
                description:
                  "Results won't refresh automatically, but can be updated manually.",
              },
            ]}
            gap="2"
            descriptionSize="md"
            value={form.watch("updateSchedule.type")}
            setValue={(v) => {
              form.setValue("updateSchedule.type", v);
            }}
          />
        </SettingsField>

        <SettingsField
          label={
            <AttributionModelTooltip>
              Conversion windows <GBInfo />
            </AttributionModelTooltip>
          }
          help="Default for metrics that define a conversion window."
        >
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
        </SettingsField>

        <Checkbox
          id="toggle-precomputed-dimensions"
          label={
            <PremiumTooltip
              commercialFeature="precomputed-dimensions"
              body={
                <>
                  <p>
                    If your exposure queries have dimension columns, this will
                    pre-compute the breakdowns for those dimensions for faster
                    slicing-and-dicing in experiments.
                  </p>
                  <p>
                    This setting will also enable post-stratification, a
                    forthcoming variance reduction technique.
                  </p>
                </>
              }
            >
              Pre-compute dimension breakdowns <GBInfo />
            </PremiumTooltip>
          }
          description="Compute dimension slices from dimension columns in your exposure queries for faster breakdowns without extra queries or joins. Costs more aggregation in each analysis query. Doesn't apply to standalone unit dimensions. Configure the slices on your Data Source page."
          disabled={!hasCommercialFeature("precomputed-dimensions")}
          value={
            hasCommercialFeature("precomputed-dimensions") &&
            !form.watch("disablePrecomputedDimensions")
          }
          setValue={(v) => form.setValue("disablePrecomputedDimensions", !v)}
        />

        <SettingsField
          label="Minimum length for imported experiments"
          help="Past experiments from a Data Source that ran for fewer days are skipped on import."
        >
          <Box width="150px">
            <Field
              size="legacy"
              type="number"
              append="days"
              step="1"
              min="0"
              max="31"
              containerClassName="mb-0"
              disabled={hasFileConfig()}
              {...form.register("pastExperimentsMinLength", {
                valueAsNumber: true,
                min: 0,
                max: 31,
              })}
            />
          </Box>
        </SettingsField>
      </SettingsGroup>

      <SettingsGroup
        id="exp-sticky"
        title="Sticky bucketing"
        description="Keep users in the variation they first saw."
        keywords="sticky bucketing consistent assignment fallback attributes"
      >
        <StickyBucketingSettings />
      </SettingsGroup>

      <SettingsGroup
        id="exp-health"
        title="Health checks"
        description="Checks that flag problems with traffic and assignment."
        keywords="health traffic query srm sample ratio mismatch multiple exposures"
      >
        <Checkbox
          id="toggle-runHealthTrafficQuery"
          label="Run traffic query by default"
          description="Check traffic splits and health on every new analysis."
          value={form.watch("runHealthTrafficQuery")}
          setValue={(v) => form.setValue("runHealthTrafficQuery", v)}
        />

        <SettingsField
          label="SRM p-value threshold"
          help="Flag sample ratio mismatch below this p-value. Default is 0.001."
        >
          <Box width="150px">
            <Field
              size="legacy"
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
              containerClassName="mb-0"
              disabled={hasFileConfig()}
              {...form.register("srmThreshold", {
                valueAsNumber: true,
                min: 0,
                max: 1,
              })}
            />
          </Box>
          {srmWarningMsg && (
            <HelperText status="warning" size="sm" mt="1">
              {srmWarningMsg}
            </HelperText>
          )}
        </SettingsField>

        <SettingsField
          label="Multiple exposures warning"
          help="Warn when at least this percent of experiment users are in multiple variations."
        >
          <Box width="150px">
            <Field
              size="legacy"
              type="number"
              step="1"
              min="0"
              max="100"
              append="%"
              containerClassName="mb-0"
              disabled={hasFileConfig()}
              {...form.register("multipleExposureMinPercent", {
                valueAsNumber: true,
                min: 0,
                max: 100,
              })}
            />
          </Box>
        </SettingsField>
      </SettingsGroup>

      <SettingsGroup
        id="exp-decision"
        title={
          <PremiumTooltip commercialFeature="decision-framework">
            Decision framework
          </PremiumTooltip>
        }
        description="Estimate experiment duration and make shipping recommendations from target minimum detectable effects."
        keywords="decision framework shipping recommendation mde minimum runtime decision criteria"
      >
        <DecisionFrameworkSettings />
      </SettingsGroup>

      {editChecklistOpen ? (
        <ExperimentCheckListModal close={() => setEditChecklistOpen(false)} />
      ) : null}
    </>
  );
}

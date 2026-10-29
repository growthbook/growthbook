import React from "react";
import { useFormContext, UseFormReturn } from "react-hook-form";
import {
  DEFAULT_CONFIDENCE_LEVEL,
  DEFAULT_P_VALUE_THRESHOLD,
  DEFAULT_POST_STRATIFICATION_ENABLED,
  DEFAULT_PROPER_PRIOR_STDDEV,
  DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
  DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
} from "shared/constants";
import { StatsEngine, PValueCorrection } from "shared/types/stats";
import { MetricDefaults } from "shared/types/organization";
import { Box, Flex } from "@radix-ui/themes";
import { useSettingsForm } from "@/components/GeneralSettings/SettingsFormProvider";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { useUser } from "@/services/UserContext";
import { hasFileConfig } from "@/services/env";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import HelperText from "@/ui/HelperText";
import Link from "@/ui/Link";
import Text from "@/ui/Text";
import { GBSequential } from "@/components/Icons";
import {
  SettingsField,
  SettingsGroup,
  SettingsSubheading,
  UnsavedMark,
} from "@/components/GeneralSettings/SettingsGroup";
import { getConfidenceLevelHighlight } from "./ChanceToWinThresholdField";
import { getPValueThresholdHighlight } from "./PValueThresholdField";

interface FormValues {
  decisionFrameworkEnabled: boolean;
  metricDefaults: MetricDefaults;
  statsEngine: StatsEngine;
  confidenceLevel: number;
  pValueThreshold: number;
  pValueCorrection: PValueCorrection;
  sequentialTestingTuningParameter: number;
  sequentialTestingEnabled: boolean;
  regressionAdjustmentEnabled: boolean;
  regressionAdjustmentDays: number;
  postStratificationEnabled: boolean;
}

export type StatsEngineSettingsForm = UseFormReturn<FormValues>;

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

export default function StatsEngineSettings() {
  const form = useFormContext<FormValues>();
  const { defaultFor } = useSettingsForm();
  const { hasCommercialFeature } = useUser();
  const locked = hasFileConfig();

  const confidence = getConfidenceLevelHighlight(form.watch("confidenceLevel"));
  const pValue = getPValueThresholdHighlight(form.watch("pValueThreshold"));

  const regressionAdjustmentDays = form.watch("regressionAdjustmentDays");
  const regressionAdjustmentDaysHighlightColor =
    typeof regressionAdjustmentDays !== "undefined"
      ? regressionAdjustmentDays > 28 || regressionAdjustmentDays < 7
        ? "#e27202"
        : ""
      : "";
  const regressionAdjustmentDaysWarningMsg =
    typeof regressionAdjustmentDays !== "undefined"
      ? regressionAdjustmentDays > 28
        ? "Longer lookback windows can sometimes be useful, but also will reduce query performance and may incorporate less useful data"
        : regressionAdjustmentDays < 7
          ? "Lookback windows under 7 days tend not to capture enough metric data to reduce variance and may be subject to weekly seasonality"
          : ""
      : "";

  const sequentialEnabled = form.watch("sequentialTestingEnabled");
  const properPriors = form.watch("metricDefaults.priorSettings.proper");
  const priorMean = form.watch("metricDefaults.priorSettings.mean");
  const priorStdDev = form.watch("metricDefaults.priorSettings.stddev");

  const highlight = (color: string) => ({
    borderColor: color,
    backgroundColor: color ? color + "15" : "",
  });

  return (
    <>
      <SettingsGroup
        id="an-engine"
        title="Stats Engine"
        description="The default engine for new experiments. Bayesian is most common."
        keywords="bayesian frequentist statistics engine chance to win priors p-value significance multiple comparisons correction sequential testing"
      >
        <SettingsField
          name="statsEngine"
          htmlFor="settings-statsEngine"
          label="Default stats engine"
        >
          <Box width="240px" maxWidth="100%">
            <SelectField
              id="settings-statsEngine"
              containerClassName="mb-0"
              sort={false}
              options={[
                { label: "Bayesian", value: "bayesian" },
                { label: "Frequentist", value: "frequentist" },
              ]}
              value={form.watch("statsEngine")}
              onChange={(v) => form.setValue("statsEngine", v as StatsEngine)}
            />
          </Box>
        </SettingsField>

        <SettingsSubheading>Bayesian</SettingsSubheading>
        <SettingsField
          name="confidenceLevel"
          htmlFor="settings-confidenceLevel"
          label="Chance to win threshold"
          help={`A variation is a winner above this probability. Default is ${Math.round(DEFAULT_CONFIDENCE_LEVEL * 100)}%.`}
        >
          <Box width="150px">
            <Field
              id="settings-confidenceLevel"
              size="md"
              type="number"
              step="any"
              min="70"
              max="99.9999"
              append="%"
              containerClassName="mb-0"
              style={highlight(confidence.highlightColor)}
              disabled={locked}
              placeholder={defaultFor("confidenceLevel")}
              {...form.register("confidenceLevel", {
                valueAsNumber: true,
                min: 70,
                max: 99.9999,
              })}
            />
          </Box>
          {confidence.warningMsg && (
            <HelperText status="warning" size="sm" mt="1">
              {confidence.warningMsg}
            </HelperText>
          )}
        </SettingsField>
        <Box>
          <UnsavedMark name="metricDefaults.priorSettings.proper">
            <Checkbox
              id="toggle-properPrior"
              label="Use proper priors"
              description="Can be overridden per metric."
              disabled={locked}
              value={!!properPriors}
              setValue={(v) =>
                form.setValue("metricDefaults.priorSettings.proper", v)
              }
            />
          </UnsavedMark>
          {properPriors && (
            <Flex direction="column" gap="3" pl="5" mt="3">
              <SettingsField
                name="metricDefaults.priorSettings.mean"
                htmlFor="settings-metricDefaults-priorSettings-mean"
                label="Prior mean"
                help="Default is 0."
              >
                <Box width="150px">
                  <Field
                    id="settings-metricDefaults-priorSettings-mean"
                    size="md"
                    type="number"
                    step="any"
                    containerClassName="mb-0"
                    disabled={locked}
                    required
                    placeholder={defaultFor(
                      "metricDefaults.priorSettings.mean",
                    )}
                    {...form.register("metricDefaults.priorSettings.mean", {
                      valueAsNumber: true,
                    })}
                  />
                </Box>
              </SettingsField>
              <SettingsField
                name="metricDefaults.priorSettings.stddev"
                htmlFor="settings-metricDefaults-priorSettings-stddev"
                label="Prior standard deviation"
                help={`Default is ${DEFAULT_PROPER_PRIOR_STDDEV}.`}
              >
                <Box width="150px">
                  <Field
                    id="settings-metricDefaults-priorSettings-stddev"
                    size="md"
                    type="number"
                    step="any"
                    min="0"
                    containerClassName="mb-0"
                    disabled={locked}
                    required
                    placeholder={defaultFor(
                      "metricDefaults.priorSettings.stddev",
                    )}
                    {...form.register("metricDefaults.priorSettings.stddev", {
                      valueAsNumber: true,
                      validate: (v) => {
                        return !(v <= 0);
                      },
                    })}
                  />
                </Box>
              </SettingsField>
              <Text size="sm" color="text-mid">
                {`Your prior distribution specifies that the average lift is ${percentFormatter.format(
                  priorMean,
                )}, and that ~68% of experiment lifts lie between ${percentFormatter.format(
                  -1 * priorStdDev + priorMean,
                )} and ${percentFormatter.format(priorStdDev + priorMean)}.`}
              </Text>
            </Flex>
          )}
        </Box>

        <SettingsSubheading>Frequentist</SettingsSubheading>
        <SettingsField
          name="pValueThreshold"
          htmlFor="settings-pValueThreshold"
          label="P-value threshold"
          help={`A result is significant below this p-value. Default is ${DEFAULT_P_VALUE_THRESHOLD}.`}
        >
          <Box width="150px">
            <Field
              id="settings-pValueThreshold"
              size="md"
              type="number"
              step="any"
              min="0"
              max="0.5"
              containerClassName="mb-0"
              style={highlight(pValue.highlightColor)}
              disabled={locked}
              placeholder={defaultFor("pValueThreshold")}
              {...form.register("pValueThreshold", {
                valueAsNumber: true,
                // Empty means the default, so NaN passes like the fields above.
                validate: (v) => Number.isNaN(v) || (v > 0 && v <= 0.5),
              })}
            />
          </Box>
          {pValue.warningMsg && (
            <HelperText status="warning" size="sm" mt="1">
              {pValue.warningMsg}
            </HelperText>
          )}
        </SettingsField>
        <SettingsField
          name="pValueCorrection"
          htmlFor="settings-pValueCorrection"
          label="Multiple comparisons correction"
          help="Applied to experiments with several goal metrics or variations."
        >
          <Box width="400px" maxWidth="100%">
            <SelectField
              id="settings-pValueCorrection"
              containerClassName="mb-0"
              value={form.watch("pValueCorrection") ?? ""}
              onChange={(value) =>
                form.setValue("pValueCorrection", value as PValueCorrection)
              }
              sort={false}
              options={[
                { label: "None", value: "" },
                {
                  label: "Holm-Bonferroni (control family-wise error rate)",
                  value: "holm-bonferroni",
                },
                {
                  label: "Benjamini-Hochberg (control false discovery rate)",
                  value: "benjamini-hochberg",
                },
              ]}
            />
          </Box>
        </SettingsField>
        <Box>
          <UnsavedMark name="sequentialTestingEnabled">
            <Checkbox
              id="toggle-sequentialTestingEnabled"
              label={
                <PremiumTooltip commercialFeature="sequential-testing">
                  <GBSequential /> Use sequential testing by default
                </PremiumTooltip>
              }
              description="Check results while an experiment runs without raising the false positive rate."
              value={!!sequentialEnabled}
              setValue={(value) => {
                form.setValue("sequentialTestingEnabled", value);
              }}
              disabled={!hasCommercialFeature("sequential-testing") || locked}
            />
          </UnsavedMark>
          {sequentialEnabled && form.watch("statsEngine") === "bayesian" && (
            <HelperText status="warning" size="sm" mt="1">
              Your organization uses Bayesian statistics by default and
              sequential testing is not implemented for the Bayesian stats
              engine.
            </HelperText>
          )}
          {sequentialEnabled && (
            <Box pl="5" mt="3">
              <SettingsField
                name="sequentialTestingTuningParameter"
                htmlFor="settings-sequentialTestingTuningParameter"
                label="Sequential testing tuning parameter"
                help={`Default is ${DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER}.`}
              >
                <Box width="150px">
                  <Field
                    id="settings-sequentialTestingTuningParameter"
                    size="md"
                    type="number"
                    containerClassName="mb-0"
                    min="0"
                    disabled={
                      !hasCommercialFeature("sequential-testing") || locked
                    }
                    placeholder={defaultFor("sequentialTestingTuningParameter")}
                    {...form.register("sequentialTestingTuningParameter", {
                      valueAsNumber: true,
                      validate: (v) => {
                        return !(v <= 0);
                      },
                    })}
                  />
                </Box>
              </SettingsField>
            </Box>
          )}
        </Box>
      </SettingsGroup>

      <SettingsGroup
        id="an-variance"
        title={
          <PremiumTooltip commercialFeature="regression-adjustment">
            Variance Reduction
          </PremiumTooltip>
        }
        description="CUPED and post-stratification reduce noise so experiments reach decisions faster."
        keywords="cuped variance reduction regression adjustment lookback post-stratification"
      >
        <Box>
          <UnsavedMark name="regressionAdjustmentEnabled">
            <Checkbox
              id="toggle-regressionAdjustmentEnabled"
              label="Use CUPED by default"
              description="Applies to all new experiments."
              value={form.watch("regressionAdjustmentEnabled")}
              setValue={(v) => {
                form.setValue("regressionAdjustmentEnabled", v);
              }}
              disabled={
                !hasCommercialFeature("regression-adjustment") || locked
              }
            />
          </UnsavedMark>
          {form.watch("regressionAdjustmentEnabled") && (
            <Box pl="5" mt="3">
              <SettingsField
                name="regressionAdjustmentDays"
                htmlFor="settings-regressionAdjustmentDays"
                label="CUPED lookback window"
                help={`Pre-exposure data used for CUPED. Default is ${DEFAULT_REGRESSION_ADJUSTMENT_DAYS}.`}
              >
                <Box width="150px">
                  <Field
                    id="settings-regressionAdjustmentDays"
                    size="md"
                    type="number"
                    style={highlight(regressionAdjustmentDaysHighlightColor)}
                    containerClassName="mb-0"
                    append="days"
                    min="0"
                    disabled={
                      !hasCommercialFeature("regression-adjustment") || locked
                    }
                    placeholder={defaultFor("regressionAdjustmentDays")}
                    {...form.register("regressionAdjustmentDays", {
                      valueAsNumber: true,
                      validate: (v) =>
                        v === undefined || Number.isNaN(v) || v > 0,
                    })}
                  />
                </Box>
                {regressionAdjustmentDaysWarningMsg && (
                  <Callout status="warning" mt="2">
                    {regressionAdjustmentDaysWarningMsg}
                  </Callout>
                )}
              </SettingsField>
            </Box>
          )}
        </Box>
        <UnsavedMark name="postStratificationEnabled">
          <Checkbox
            id="toggle-postStratification"
            label="Use post-stratification by default"
            description={
              <>
                Used whenever{" "}
                <Link href="#exp-results">pre-computed dimensions</Link> are
                available.
              </>
            }
            value={
              form.watch("postStratificationEnabled") ??
              DEFAULT_POST_STRATIFICATION_ENABLED
            }
            setValue={(v) => {
              form.setValue("postStratificationEnabled", v);
            }}
            disabled={locked}
          />
        </UnsavedMark>
      </SettingsGroup>
    </>
  );
}

import React from "react";
import { useFormContext, UseFormReturn } from "react-hook-form";
import {
  DEFAULT_CONFIDENCE_LEVEL,
  DEFAULT_P_VALUE_THRESHOLD,
  DEFAULT_POST_STRATIFICATION_ENABLED,
  DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
  DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER,
} from "shared/constants";
import { StatsEngine, PValueCorrection } from "shared/types/stats";
import { MetricDefaults } from "shared/types/organization";
import { Box } from "@radix-ui/themes";
import StatsEngineSelect from "@/components/Settings/forms/StatsEngineSelect";
import BayesianPriorSettings from "@/components/Settings/BayesianPriorSettings";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { useUser } from "@/services/UserContext";
import { hasFileConfig } from "@/services/env";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import HelperText from "@/ui/HelperText";
import Link from "@/ui/Link";
import Switch from "@/ui/Switch";
import { GBSequential } from "@/components/Icons";
import {
  SettingsField,
  SettingsGroup,
  SettingsSubheading,
} from "@/components/GeneralSettings/SettingsGroup";
import ChanceToWinThresholdField from "./ChanceToWinThresholdField";
import PValueThresholdField from "./PValueThresholdField";

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

/** Stats engine and variance reduction groups of the Statistics section. */
export default function StatsEngineSettings() {
  const form = useFormContext<FormValues>();
  const { hasCommercialFeature } = useUser();

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

  return (
    <>
      <SettingsGroup
        id="an-engine"
        title="Stats engine"
        description="The default engine for new experiments. Bayesian is most common."
        keywords="bayesian frequentist statistics engine chance to win priors p-value significance multiple comparisons correction sequential testing"
      >
        <StatsEngineSelect
          label="Default stats engine"
          allowUndefined={false}
          value={form.watch("statsEngine")}
          onChange={(value) => {
            form.setValue("statsEngine", value);
          }}
        />

        <SettingsSubheading>Bayesian</SettingsSubheading>
        <ChanceToWinThresholdField
          form={form}
          name="confidenceLevel"
          value={form.watch("confidenceLevel")}
          defaultValue={Math.round(DEFAULT_CONFIDENCE_LEVEL * 100)}
          disabled={hasFileConfig()}
          helpTextAppend={
            <span className="ml-2">
              Default is {Math.round(DEFAULT_CONFIDENCE_LEVEL * 100)}%.
            </span>
          }
          rules={{ valueAsNumber: true }}
        />
        <BayesianPriorSettings />

        <SettingsSubheading>Frequentist</SettingsSubheading>
        <PValueThresholdField
          form={form}
          name="pValueThreshold"
          value={form.watch("pValueThreshold")}
          defaultValue={DEFAULT_P_VALUE_THRESHOLD}
          disabled={hasFileConfig()}
          helpTextAppend={
            <span className="ml-2">
              Default is {DEFAULT_P_VALUE_THRESHOLD}.
            </span>
          }
          rules={{ valueAsNumber: true }}
        />
        <SettingsField
          label="Multiple comparisons correction"
          help="Applied to experiments with several goal metrics or variations."
        >
          <SelectField
            value={form.watch("pValueCorrection") ?? ""}
            onChange={(value) =>
              form.setValue("pValueCorrection", value as PValueCorrection)
            }
            sort={false}
            options={[
              { label: "None", value: "" },
              {
                label: "Holm-Bonferroni (Control FWER)",
                value: "holm-bonferroni",
              },
              {
                label: "Benjamini-Hochberg (Control FDR)",
                value: "benjamini-hochberg",
              },
            ]}
          />
        </SettingsField>
        <Box>
          <Switch
            id="toggle-sequentialTestingEnabled"
            value={sequentialEnabled}
            label={
              <PremiumTooltip commercialFeature="sequential-testing">
                <GBSequential /> Use sequential testing by default
              </PremiumTooltip>
            }
            onChange={(value) => {
              form.setValue("sequentialTestingEnabled", value);
            }}
            disabled={
              !hasCommercialFeature("sequential-testing") || hasFileConfig()
            }
            mb="1"
          />
          <HelperText status="info" size="sm">
            Check results while an experiment runs without raising the false
            positive rate.
          </HelperText>
          {sequentialEnabled && form.watch("statsEngine") === "bayesian" && (
            <HelperText status="warning" size="sm" mt="1">
              Your organization uses Bayesian statistics by default and
              sequential testing is not implemented for the Bayesian stats
              engine.
            </HelperText>
          )}
        </Box>
        <SettingsField
          label="Sequential testing tuning parameter"
          help={`Default is ${DEFAULT_SEQUENTIAL_TESTING_TUNING_PARAMETER}.`}
        >
          <Box width="150px" style={{ opacity: sequentialEnabled ? 1 : 0.5 }}>
            <Field
              type="number"
              containerClassName="mb-0"
              min="0"
              disabled={
                !hasCommercialFeature("sequential-testing") || hasFileConfig()
              }
              {...form.register("sequentialTestingTuningParameter", {
                valueAsNumber: true,
                validate: (v) => {
                  return !(v <= 0);
                },
              })}
            />
          </Box>
        </SettingsField>
      </SettingsGroup>

      <SettingsGroup
        id="an-variance"
        title={
          <PremiumTooltip commercialFeature="regression-adjustment">
            Variance reduction
          </PremiumTooltip>
        }
        description="CUPED and post-stratification reduce noise so experiments reach decisions faster."
        keywords="cuped variance reduction regression adjustment lookback post-stratification"
      >
        <Checkbox
          id="toggle-regressionAdjustmentEnabled"
          label="Use CUPED by default"
          description="Applies to all new experiments."
          value={form.watch("regressionAdjustmentEnabled")}
          setValue={(v) => {
            form.setValue("regressionAdjustmentEnabled", v);
          }}
          disabled={
            !hasCommercialFeature("regression-adjustment") || hasFileConfig()
          }
        />
        <SettingsField
          label="CUPED lookback window"
          help={`Pre-exposure data used for CUPED. Default is ${DEFAULT_REGRESSION_ADJUSTMENT_DAYS}.`}
        >
          <Box width="150px">
            <Field
              type="number"
              style={{
                borderColor: regressionAdjustmentDaysHighlightColor,
                backgroundColor: regressionAdjustmentDaysHighlightColor
                  ? regressionAdjustmentDaysHighlightColor + "15"
                  : "",
              }}
              containerClassName="mb-0"
              append="days"
              min="0"
              disabled={
                !hasCommercialFeature("regression-adjustment") ||
                hasFileConfig()
              }
              {...form.register("regressionAdjustmentDays", {
                valueAsNumber: true,
                validate: (v) => {
                  return v === undefined || v > 0;
                },
              })}
            />
          </Box>
          {regressionAdjustmentDaysWarningMsg && (
            <Callout status="warning" mt="2">
              {regressionAdjustmentDaysWarningMsg}
            </Callout>
          )}
        </SettingsField>
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
          disabled={hasFileConfig()}
        />
      </SettingsGroup>
    </>
  );
}

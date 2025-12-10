import React, { useEffect, useState } from "react";
import { useFormContext, UseFormReturn } from "react-hook-form";
import {
  DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
  DEFAULT_STATS_ENGINE,
} from "shared/constants";
import { StatsEngine, PValueCorrection } from "shared/types/stats";
import { MetricDefaults } from "shared/types/organization";
import { Box, Flex, Heading, Text } from "@radix-ui/themes";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/ui/Tabs";
import StatsEngineSelect from "@/components/Settings/forms/StatsEngineSelect";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { useUser } from "@/services/UserContext";
import { hasFileConfig } from "@/services/env";
import Field from "@/components/Forms/Field";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import FrequentistTab from "./FrequentistTab";
import BayesianTab from "./BayesianTab";

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
  postStratificationDisabled: boolean;
}

export type StatsEngineSettingsForm = UseFormReturn<FormValues>;

export default function StatsEngineSettings() {
  const form = useFormContext<FormValues>();

  const statsEngine = form.watch("statsEngine");
  const confidenceLevel = form.watch("confidenceLevel");
  const pValueThreshold = form.watch("pValueThreshold");
  const regressionAdjustmentDays = form.watch("regressionAdjustmentDays");

  const [statsEngineTab, setStatsEngineTab] = useState<string>(
    statsEngine || DEFAULT_STATS_ENGINE,
  );

  const { hasCommercialFeature } = useUser();

  // form loads values async, this updates the tab when it finally does
  useEffect(() => {
    setStatsEngineTab(statsEngine);
  }, [statsEngine]);

  const highlightColor =
    typeof confidenceLevel !== "undefined"
      ? confidenceLevel < 70
        ? "#c73333"
        : confidenceLevel < 80
          ? "#e27202"
          : confidenceLevel < 90
            ? "#B39F01"
            : ""
      : "";

  const warningMsg =
    typeof confidenceLevel !== "undefined"
      ? confidenceLevel === 70
        ? "This is as low as it goes"
        : confidenceLevel < 75
          ? "Confidence thresholds this low are not recommended"
          : confidenceLevel < 80
            ? "Confidence thresholds this low are not recommended"
            : confidenceLevel < 90
              ? "Use caution with values below 90%"
              : confidenceLevel >= 99
                ? "Confidence levels 99% and higher can take lots of data to achieve"
                : ""
      : "";

  const pHighlightColor =
    typeof pValueThreshold !== "undefined"
      ? pValueThreshold > 0.3
        ? "#c73333"
        : pValueThreshold > 0.2
          ? "#e27202"
          : pValueThreshold > 0.1
            ? "#B39F01"
            : ""
      : "";

  const pWarningMsg =
    typeof pValueThreshold !== "undefined"
      ? pValueThreshold === 0.5
        ? "This is as high as it goes"
        : pValueThreshold > 0.25
          ? "P-value thresholds this high are not recommended"
          : pValueThreshold > 0.2
            ? "P-value thresholds this high are not recommended"
            : pValueThreshold > 0.1
              ? "Use caution with values above 0.1"
              : pValueThreshold <= 0.01
                ? "Threshold values of 0.01 and lower can take lots of data to achieve"
                : ""
      : "";

  const regressionAdjustmentDaysHighlightColor =
    typeof regressionAdjustmentDays !== "undefined"
      ? regressionAdjustmentDays > 28 || regressionAdjustmentDays < 7
        ? "#e27202"
        : ""
      : "";

  const regressionAdjustmentDaysWarningMsg =
    typeof regressionAdjustmentDays !== "undefined"
      ? regressionAdjustmentDays > 28
        ? "Longer lookback periods can sometimes be useful, but also will reduce query performance and may incorporate less useful data"
        : regressionAdjustmentDays < 7
          ? "Lookback periods under 7 days tend not to capture enough metric data to reduce variance and may be subject to weekly seasonality"
          : ""
      : "";

  return (
    <Box className="mb-3 form-group align-items-start" width="100%">
      <h4>Stats Engine Settings</h4>

      <StatsEngineSelect
        label="Default statistics engine to use (Bayesian is most common)"
        allowUndefined={false}
        showDefault={true}
        value={form.watch("statsEngine")}
        onChange={(value) => {
          form.setValue("statsEngine", value);
        }}
        labelClassName="mr-2"
      />

      <div className="mt-3">
        <Tabs
          value={statsEngineTab}
          onValueChange={(v) => setStatsEngineTab(v)}
        >
          <TabsList>
            <TabsTrigger value="bayesian">Bayesian</TabsTrigger>
            <TabsTrigger value="frequentist">Frequentist</TabsTrigger>
          </TabsList>

          <TabsContent value="frequentist">
            <Box mt="4">
              <FrequentistTab
                {...{
                  pHighlightColor,
                  pWarningMsg,
                  regressionAdjustmentDaysHighlightColor,
                  regressionAdjustmentDaysWarningMsg,
                  form,
                }}
              />
            </Box>
          </TabsContent>
          <TabsContent value="bayesian">
            <Box mt="4">
              <BayesianTab
                {...{
                  highlightColor,
                  warningMsg,
                  form,
                }}
              />
            </Box>
          </TabsContent>
        </Tabs>
      </div>

      <Box className="appbox" mb="6" p="4">
        <Heading as="h4" size="3" mb="4">
          <PremiumTooltip commercialFeature="regression-adjustment">
            Variance Reduction (CUPEDps)
          </PremiumTooltip>
        </Heading>
        <Flex direction="column" gap="3">
          <Flex align="start" gap="3">
            <Checkbox
              id="toggle-regressionAdjustmentEnabled"
              value={form.watch("regressionAdjustmentEnabled")}
              setValue={(v) => {
                form.setValue("regressionAdjustmentEnabled", v);
              }}
              disabled={
                !hasCommercialFeature("regression-adjustment") ||
                hasFileConfig()
              }
            />
            <Box>
              <Text size="2" className="font-weight-semibold">
                <label htmlFor="toggle-regressionAdjustmentEnabled">
                  Use CUPEDps by default on all experiments
                </label>
              </Text>
              <Text as="p" mb="1" size="2" className="font-weight-semibold">
                Default CUPED lookback (days)
              </Text>
              <Box mb="2">
                <Text as="span" size="1" className="text-muted">
                  ({DEFAULT_REGRESSION_ADJUSTMENT_DAYS} is default)
                </Text>
              </Box>
              <Box width="140px" mb="4">
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
                  max="100"
                  disabled={
                    !hasCommercialFeature("regression-adjustment") ||
                    hasFileConfig()
                  }
                  {...form.register("regressionAdjustmentDays", {
                    valueAsNumber: true,
                    validate: (v) => {
                      return !(v <= 0 || v > 100);
                    },
                  })}
                />
              </Box>
              {regressionAdjustmentDaysWarningMsg && (
                <Callout status="warning" mt="2">
                  {regressionAdjustmentDaysWarningMsg}
                </Callout>
              )}
            </Box>
          </Flex>
          <Flex align="start" gap="3">
            <Checkbox
              id="toggle-postStratification"
              value={!form.watch("postStratificationDisabled")}
              setValue={(v) => {
                form.setValue("postStratificationDisabled", !v);
              }}
              disabled={hasFileConfig()}
            />
            <Flex direction="column">
              <Text size="2" className="font-weight-semibold">
                <label htmlFor="toggle-postStratification">
                  Enable post-stratification
                </label>
              </Text>
              <Text size="1">
                When checked, post-stratification will be used whenever CUPEDps
                is enabled and pre-computed dimensions are available.
              </Text>
            </Flex>
          </Flex>
        </Flex>
      </Box>
    </Box>
  );
}

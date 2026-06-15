import { useFormContext } from "react-hook-form";
import { useEffect, useMemo, useRef } from "react";
import { getMetricWindowHours } from "shared/experiments";
import { isProjectListValidForProject } from "shared/util";
import { MetricWindowSettings } from "shared/types/fact-table";
import { Box, Grid } from "@radix-ui/themes";
import clsx from "clsx";
import Field from "@/components/Forms/Field";
import useOrgSettings from "@/hooks/useOrgSettings";
import SelectField from "@/components/Forms/SelectField";
import { useDefinitions } from "@/services/DefinitionsContext";
import ExperimentMetricsSelector from "@/components/Experiment/ExperimentMetricsSelector";
import Checkbox from "@/ui/Checkbox";
import Text from "@/ui/Text";
import Callout from "@/ui/Callout";

function conversionWindowFromScheduleHours(scheduleHours: number): {
  value: number;
  unit: "hours" | "days";
} {
  const windowHours = Math.max(1, scheduleHours / 10);
  if (windowHours >= 24) {
    return { value: windowHours / 24, unit: "days" };
  }
  return { value: Math.min(23, Math.round(windowHours)), unit: "hours" };
}

function conversionWindowFormValuesFromHours(hours: number): {
  value: number;
  unit: "hours" | "days";
} {
  if (hours > 23) {
    return {
      value: Math.max(1, Math.round(hours / 24)),
      unit: "days",
    };
  }
  return { value: Math.max(1, Math.round(hours)), unit: "hours" };
}

function conversionWindowFormValuesFromMetricWindow(
  windowSettings: MetricWindowSettings,
): { value: number; unit: "hours" | "days" } {
  return conversionWindowFormValuesFromHours(
    getMetricWindowHours(windowSettings),
  );
}

export type BanditDecisionMetricSettingsProps = {
  disableBanditConversionWindow: boolean;
  setDisableBanditConversionWindow: (v: boolean) => void;
  project?: string;
  disabled?: boolean;
  contextualBandit?: boolean;
};

export default function BanditDecisionMetricSettings({
  disableBanditConversionWindow,
  setDisableBanditConversionWindow,
  project,
  disabled = false,
  contextualBandit = false,
}: BanditDecisionMetricSettingsProps) {
  const form = useFormContext();
  const settings = useOrgSettings();
  const { getExperimentMetricById, factMetrics } = useDefinitions();

  const datasourceId = form.watch("datasource") ?? "";
  const exposureQueryId = form.watch("exposureQueryId");

  // Contextual bandits require a fact metric as the decision metric.
  const hasFactMetricForDatasource = useMemo(() => {
    if (!datasourceId) return true;
    return factMetrics.some(
      (m) =>
        m.datasource === datasourceId &&
        isProjectListValidForProject(m.projects, project),
    );
  }, [factMetrics, datasourceId, project]);
  const showNoFactMetricsMessage =
    contextualBandit && !!datasourceId && !hasFactMetricForDatasource;

  const goalMetricId = form.watch("goalMetrics")?.[0];
  const goalMetric = goalMetricId
    ? getExperimentMetricById(goalMetricId)
    : null;
  const goalMetricWindow =
    goalMetric?.windowSettings.type === "conversion"
      ? goalMetric.windowSettings
      : null;
  const defaultConversionWindowHours = useMemo(() => {
    if (goalMetricWindow) {
      return getMetricWindowHours(goalMetricWindow);
    }
    return 1;
  }, [goalMetricWindow]);

  const conversionWindowUnit = form.watch("banditConversionWindowUnit");
  const conversionWindowValue = form.watch("banditConversionWindowValue");

  function setDefaultConversionWindowOverride(decisionMetricId: string) {
    const decisionMetric = getExperimentMetricById(decisionMetricId);
    if (!decisionMetric) {
      return;
    }
    const decisionMetricWindow = decisionMetric.windowSettings;
    // If the decision metric does not have a conversion window, reset the conversion window override
    if (decisionMetricWindow.type !== "conversion") {
      form.setValue("banditConversionWindowValue", undefined);
      form.setValue("banditConversionWindowUnit", "hours");
    }
    // If the decision metric has a conversion window, set the conversion window override
    else if (decisionMetricWindow.windowValue >= 24) {
      form.setValue(
        "banditConversionWindowValue",
        decisionMetricWindow.windowValue / 24,
      );
      form.setValue("banditConversionWindowUnit", "days");
    } else {
      form.setValue(
        "banditConversionWindowValue",
        decisionMetricWindow.windowValue,
      );
      form.setValue("banditConversionWindowUnit", "hours");
    }
  }

  const conversionWindowOverrideHours = useMemo(() => {
    if (disableBanditConversionWindow) {
      return null;
    }
    return conversionWindowValue && conversionWindowUnit
      ? parseFloat(String(conversionWindowValue)) *
          (conversionWindowUnit === "days" ? 24 : 1)
      : null;
  }, [
    disableBanditConversionWindow,
    conversionWindowValue,
    conversionWindowUnit,
  ]);

  const scheduleHours =
    parseFloat(form.watch("banditScheduleValue") ?? "0") *
    (form.watch("banditScheduleUnit") === "days" ? 24 : 1);

  const conversionWindowHours =
    conversionWindowOverrideHours ?? defaultConversionWindowHours;

  const showConversionWindowWarning =
    (contextualBandit ||
      !settings?.useStickyBucketing ||
      !!form.watch("disableStickyBucketing")) &&
    !!goalMetricId &&
    conversionWindowHours &&
    scheduleHours < conversionWindowHours * 10;

  const showConversionWindowSection =
    contextualBandit ||
    !settings?.useStickyBucketing ||
    !!form.watch("disableStickyBucketing");

  const goalMetricWindowKey = goalMetricWindow
    ? `${goalMetricWindow.windowValue}:${goalMetricWindow.windowUnit}`
    : null;

  const lastContextualMetricDefaultKey = useRef<string | null>(null);

  function applyContextualBanditConversionWindowDefault(metricId: string) {
    setDisableBanditConversionWindow(false);
    const metric = getExperimentMetricById(metricId);
    const metricWindow =
      metric?.windowSettings.type === "conversion"
        ? metric.windowSettings
        : null;
    const { value, unit } = metricWindow
      ? conversionWindowFormValuesFromMetricWindow(metricWindow)
      : conversionWindowFromScheduleHours(scheduleHours);
    form.setValue("banditConversionWindowValue", value);
    form.setValue("banditConversionWindowUnit", unit);
  }

  useEffect(() => {
    if (!contextualBandit || !goalMetricId) {
      lastContextualMetricDefaultKey.current = null;
      return;
    }
    const defaultKey = `${goalMetricId}:${goalMetricWindowKey ?? "none"}`;
    if (lastContextualMetricDefaultKey.current === defaultKey) {
      return;
    }
    lastContextualMetricDefaultKey.current = defaultKey;
    applyContextualBanditConversionWindowDefault(goalMetricId);
    // Only re-default when the selected goal metric or its window changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextualBandit, goalMetricId, goalMetricWindowKey]);

  useEffect(() => {
    if (!contextualBandit || !goalMetricId || goalMetricWindowKey) {
      return;
    }
    const { value, unit } = conversionWindowFromScheduleHours(scheduleHours);
    form.setValue("banditConversionWindowValue", value);
    form.setValue("banditConversionWindowUnit", unit);
    // Keep cadence-based defaults in sync when there is no metric-level window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextualBandit, goalMetricId, goalMetricWindowKey, scheduleHours]);

  const conversionWindowWarning = showConversionWindowWarning && !disabled && (
    <Callout status={contextualBandit ? "error" : "warning"} my="4">
      <Text>
        {contextualBandit ? (
          <>
            The decision metric conversion window must be at most 10% of the{" "}
            <Text weight="semibold">Update Cadence</Text>. Decrease the
            conversion window or increase the cadence to continue.
          </>
        ) : (
          <>
            Limit how many conversions are counted after a unit may have
            switched variations by decreasing the metric conversion window to be
            &le; 10% of the <Text weight="semibold">Update Cadence</Text>.
          </>
        )}
      </Text>
    </Callout>
  );

  if (showNoFactMetricsMessage) {
    return (
      <Callout status="info" my="2">
        This data source has no fact metrics. Contextual bandits can only use a
        fact metric as the decision metric, so create a fact metric for this
        data source before continuing.
      </Callout>
    );
  }

  return (
    <>
      <ExperimentMetricsSelector
        datasource={datasourceId || undefined}
        exposureQueryId={exposureQueryId}
        project={project}
        forceSingleGoalMetric={true}
        noQuantileGoalMetrics={true}
        noLegacyMetrics={contextualBandit}
        requireDatasource={contextualBandit}
        goalMetricsDescription={
          contextualBandit && !datasourceId
            ? "Select a data source above to choose a decision metric."
            : undefined
        }
        goalMetrics={form.watch("goalMetrics") ?? []}
        secondaryMetrics={form.watch("secondaryMetrics") ?? []}
        guardrailMetrics={form.watch("guardrailMetrics") ?? []}
        setGoalMetrics={(goalMetrics) => {
          form.setValue("goalMetrics", goalMetrics);
          if (contextualBandit && goalMetrics[0]) {
            const metric = getExperimentMetricById(goalMetrics[0]);
            const metricWindow =
              metric?.windowSettings.type === "conversion"
                ? metric.windowSettings
                : null;
            lastContextualMetricDefaultKey.current = `${goalMetrics[0]}:${
              metricWindow
                ? `${metricWindow.windowValue}:${metricWindow.windowUnit}`
                : "none"
            }`;
            applyContextualBanditConversionWindowDefault(goalMetrics[0]);
          } else if (!contextualBandit) {
            setDefaultConversionWindowOverride(goalMetrics[0]);
          }
        }}
        disabled={disabled}
      />

      {contextualBandit && goalMetricId && (
        <Text color="text-mid" size="small" as="p" my="1">
          {goalMetricWindow ? (
            <>
              Metric default: {goalMetricWindow.windowValue}{" "}
              {goalMetricWindow.windowValue === 1
                ? goalMetricWindow.windowUnit.slice(0, -1)
                : goalMetricWindow.windowUnit}
            </>
          ) : (
            "No metric-level conversion window."
          )}
        </Text>
      )}

      {(showConversionWindowSection && !contextualBandit) ||
      (contextualBandit && goalMetricId) ? (
        <Box my="5">
          <Text size="medium" weight="semibold">
            {contextualBandit
              ? "Conversion Window"
              : "Decision Metric Conversion Window Override"}
          </Text>
          {!contextualBandit &&
            goalMetricWindow?.windowUnit &&
            goalMetricWindow?.windowValue && (
              <Text color="text-mid" size="small" as="p" my="1">
                Metric default: {goalMetricWindow.windowValue}{" "}
                {goalMetricWindow.windowValue === 1
                  ? goalMetricWindow.windowUnit.slice(0, -1)
                  : goalMetricWindow.windowUnit}
              </Text>
            )}
          {contextualBandit ? (
            <>
              <Grid align="center" flow="column" gap="2" columns="auto" mt="2">
                <Field
                  {...form.register("banditConversionWindowValue", {
                    valueAsNumber: true,
                  })}
                  type="number"
                  min={1}
                  max={conversionWindowUnit === "days" ? 999 : 23}
                  step={1}
                  style={{ width: 70 }}
                  disabled={disabled}
                  className={clsx({
                    "border-warning": showConversionWindowWarning,
                  })}
                />
                <SelectField
                  value={conversionWindowUnit || "hours"}
                  onChange={(value) => {
                    form.setValue(
                      "banditConversionWindowUnit",
                      value as "hours" | "days",
                    );
                    if (value === "hours" && conversionWindowValue > 23) {
                      form.setValue("banditConversionWindowValue", 23);
                    }
                  }}
                  sort={false}
                  options={[
                    {
                      label: "Hour(s)",
                      value: "hours",
                    },
                    {
                      label: "Day(s)",
                      value: "days",
                    },
                  ]}
                  disabled={disabled}
                  style={{ width: 90, minWidth: 90 }}
                />
              </Grid>
              {conversionWindowWarning}
            </>
          ) : (
            <>
              <Grid align="end" flow="column" gap="5" columns="auto">
                <Grid
                  align="center"
                  flow="column"
                  gap="2"
                  columns="auto"
                  mt="2"
                >
                  <Field
                    {...form.register("banditConversionWindowValue", {
                      valueAsNumber: true,
                    })}
                    type="number"
                    min={1}
                    max={conversionWindowUnit === "days" ? 999 : 23}
                    step={1}
                    style={{ width: 70 }}
                    disabled={disableBanditConversionWindow || disabled}
                    className={clsx({
                      "border-warning":
                        showConversionWindowWarning &&
                        !disableBanditConversionWindow,
                    })}
                  />
                  <SelectField
                    value={conversionWindowUnit || "hours"}
                    onChange={(value) => {
                      form.setValue(
                        "banditConversionWindowUnit",
                        value as "hours" | "days",
                      );
                      if (value === "hours" && conversionWindowValue > 23) {
                        form.setValue("banditConversionWindowValue", 23);
                      }
                    }}
                    sort={false}
                    options={[
                      {
                        label: "Hour(s)",
                        value: "hours",
                      },
                      {
                        label: "Day(s)",
                        value: "days",
                      },
                    ]}
                    disabled={disableBanditConversionWindow || disabled}
                    style={{ width: 90, minWidth: 90 }}
                  />
                </Grid>
                <Box width="100px" />
                <Checkbox
                  description="Use the Decision Metric's default conversion window"
                  label="Disable Conversion Window Override"
                  labelSize="1"
                  size="sm"
                  value={disableBanditConversionWindow}
                  setValue={setDisableBanditConversionWindow}
                  disabled={disabled}
                />
              </Grid>
              {disableBanditConversionWindow &&
                !disabled &&
                !goalMetricWindow?.windowUnit &&
                !goalMetricWindow?.windowValue && (
                  <Callout status="warning" my="4">
                    Disabling the conversion window may bias results if units
                    switch variations during the experiment.
                  </Callout>
                )}
              {conversionWindowWarning}
            </>
          )}
        </Box>
      ) : null}
    </>
  );
}

import { useFormContext } from "react-hook-form";
import { useMemo } from "react";
import { getMetricWindowHours } from "shared/experiments";
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

export type BanditDecisionMetricSettingsProps = {
  disableBanditConversionWindow: boolean;
  setDisableBanditConversionWindow: (v: boolean) => void;
  project?: string;
  disabled?: boolean;
};

export default function BanditDecisionMetricSettings({
  disableBanditConversionWindow,
  setDisableBanditConversionWindow,
  project,
  disabled = false,
}: BanditDecisionMetricSettingsProps) {
  const form = useFormContext();
  const settings = useOrgSettings();
  const { getDatasourceById, getExperimentMetricById } = useDefinitions();

  const datasource = form.watch("datasource")
    ? getDatasourceById(form.watch("datasource") ?? "")
    : null;
  const exposureQueryId = form.watch("exposureQueryId");

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
    (!settings?.useStickyBucketing || !!form.watch("disableStickyBucketing")) &&
    conversionWindowHours &&
    scheduleHours < conversionWindowHours * 10;

  const showConversionWindowSection =
    !settings?.useStickyBucketing || !!form.watch("disableStickyBucketing");

  return (
    <>
      <ExperimentMetricsSelector
        datasource={datasource?.id}
        exposureQueryId={exposureQueryId}
        project={project}
        forceSingleGoalMetric={true}
        noQuantileGoalMetrics={true}
        goalMetrics={form.watch("goalMetrics") ?? []}
        secondaryMetrics={form.watch("secondaryMetrics") ?? []}
        guardrailMetrics={form.watch("guardrailMetrics") ?? []}
        setGoalMetrics={(goalMetrics) => {
          form.setValue("goalMetrics", goalMetrics);
          setDefaultConversionWindowOverride(goalMetrics[0]);
        }}
        disabled={disabled}
      />

      {showConversionWindowSection && (
        <Box my="5">
          <Text size="medium" weight="semibold">
            Decision Metric Conversion Window Override
          </Text>
          {goalMetricWindow?.windowUnit && goalMetricWindow?.windowValue && (
            <Text color="text-mid" size="small" as="p" my="1">
              Metric default: {goalMetricWindow.windowValue}{" "}
              {goalMetricWindow.windowValue === 1
                ? goalMetricWindow.windowUnit.slice(0, -1)
                : goalMetricWindow.windowUnit}
            </Text>
          )}
          <Grid align="end" flow="column" gap="5" columns="auto">
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
                Disabling the conversion window may bias results if units switch
                variations during the experiment.
              </Callout>
            )}
          {showConversionWindowWarning && !disabled && (
            <Callout status="warning" my="4">
              <Text>
                To prevent counting conversions after a unit may have switched
                variations, decrease metric conversion window to have length
                &le; 10% of the <Text weight="semibold">Update Cadence</Text>.
              </Text>
            </Callout>
          )}
        </Box>
      )}
    </>
  );
}

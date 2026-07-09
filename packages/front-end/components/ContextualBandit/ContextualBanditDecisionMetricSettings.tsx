import { useFormContext } from "react-hook-form";
import { useEffect, useMemo, useRef, useState } from "react";
import { getMetricWindowHours } from "shared/experiments";
import { isProjectListValidForProject } from "shared/util";
import {
  FactTableInterface,
  MetricWindowSettings,
} from "shared/types/fact-table";
import { Box, Flex, Grid } from "@radix-ui/themes";
import clsx from "clsx";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import { useDefinitions } from "@/services/DefinitionsContext";
import ExperimentMetricsSelector from "@/components/Experiment/ExperimentMetricsSelector";
import Text from "@/ui/Text";
import Callout from "@/ui/Callout";
import Button from "@/ui/Button";
import FactTableModal from "@/components/FactTables/FactTableModal";
import FactMetricModal from "@/components/FactTables/FactMetricModal";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";

export function conversionWindowFromScheduleHours(scheduleHours: number): {
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

export function conversionWindowFormValuesFromMetricWindow(
  windowSettings: MetricWindowSettings,
): { value: number; unit: "hours" | "days" } {
  return conversionWindowFormValuesFromHours(
    getMetricWindowHours(windowSettings),
  );
}

export type ContextualBanditDecisionMetricSettingsProps = {
  disableBanditConversionWindow: boolean;
  setDisableBanditConversionWindow: (v: boolean) => void;
  project?: string;
  disabled?: boolean;
  autoApplyDefaults?: boolean;
};

/**
 * Contextual-bandit-only decision metric picker + conversion window.
 * Bound to the single `decisionMetric` form field (CBs optimize toward exactly
 * one fact metric); converts to/from the shared selector's `goalMetrics` array
 * only at the `ExperimentMetricsSelector` prop boundary.
 */
export default function ContextualBanditDecisionMetricSettings({
  disableBanditConversionWindow,
  setDisableBanditConversionWindow,
  project,
  disabled = false,
  autoApplyDefaults = true,
}: ContextualBanditDecisionMetricSettingsProps) {
  const form = useFormContext();
  const { getExperimentMetricById, factMetrics, factTables, projects } =
    useDefinitions();
  const permissionsUtil = usePermissionsUtil();
  const [showFactTableModal, setShowFactTableModal] = useState(false);
  const [showFactMetricModal, setShowFactMetricModal] = useState(false);
  const [createdFactTable, setCreatedFactTable] =
    useState<FactTableInterface | null>(null);

  const canCreateFactTable = permissionsUtil.canViewCreateFactTableModal(
    project,
    projects,
  );

  const datasourceId = form.watch("datasource") ?? "";
  const exposureQueryId = form.watch("exposureQueryId");

  const hasFactMetricForDatasource = useMemo(() => {
    if (!datasourceId) return true;
    return factMetrics.some(
      (m) =>
        m.datasource === datasourceId &&
        (m.metricType === "mean" || m.metricType === "proportion") &&
        isProjectListValidForProject(m.projects, project),
    );
  }, [factMetrics, datasourceId, project]);
  const showNoFactMetricsMessage =
    !!datasourceId && !hasFactMetricForDatasource;

  const factTablesForDatasource = useMemo(() => {
    if (!datasourceId) return [];
    return factTables.filter(
      (t) =>
        t.datasource === datasourceId &&
        isProjectListValidForProject(t.projects, project),
    );
  }, [factTables, datasourceId, project]);
  const factTableForMetric =
    createdFactTable ?? factTablesForDatasource[0] ?? null;
  const canCreateFactMetric = factTableForMetric
    ? permissionsUtil.canCreateFactMetric({
        projects: factTableForMetric.projects,
      })
    : false;

  const decisionMetricId = form.watch("decisionMetric") || undefined;
  const decisionMetric = decisionMetricId
    ? getExperimentMetricById(decisionMetricId)
    : null;
  const decisionMetricWindow =
    decisionMetric?.windowSettings.type === "conversion"
      ? decisionMetric.windowSettings
      : null;

  const conversionWindowUnit = form.watch("banditConversionWindowUnit");
  const conversionWindowValue = form.watch("banditConversionWindowValue");

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

  const defaultConversionWindowHours = useMemo(() => {
    if (decisionMetricWindow) {
      return getMetricWindowHours(decisionMetricWindow);
    }
    return 1;
  }, [decisionMetricWindow]);

  const conversionWindowHours =
    conversionWindowOverrideHours ?? defaultConversionWindowHours;

  const showConversionWindowWarning =
    !!decisionMetricId &&
    conversionWindowHours &&
    scheduleHours < conversionWindowHours * 10;

  const decisionMetricWindowKey = decisionMetricWindow
    ? `${decisionMetricWindow.windowValue}:${decisionMetricWindow.windowUnit}`
    : null;

  const lastMetricDefaultKey = useRef<string | null>(null);

  function applyConversionWindowDefault(metricId: string) {
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
    if (!decisionMetricId) {
      lastMetricDefaultKey.current = null;
      return;
    }
    const defaultKey = `${decisionMetricId}:${decisionMetricWindowKey ?? "none"}`;
    if (lastMetricDefaultKey.current === defaultKey) {
      return;
    }
    if (!autoApplyDefaults && lastMetricDefaultKey.current === null) {
      lastMetricDefaultKey.current = defaultKey;
      return;
    }
    lastMetricDefaultKey.current = defaultKey;
    applyConversionWindowDefault(decisionMetricId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decisionMetricId, decisionMetricWindowKey]);

  useEffect(() => {
    if (!autoApplyDefaults || !decisionMetricId || decisionMetricWindowKey) {
      return;
    }
    const { value, unit } = conversionWindowFromScheduleHours(scheduleHours);
    form.setValue("banditConversionWindowValue", value);
    form.setValue("banditConversionWindowUnit", unit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decisionMetricId, decisionMetricWindowKey, scheduleHours]);

  const conversionWindowWarning = showConversionWindowWarning && !disabled && (
    <Callout status="warning" my="4">
      <Text>
        Consider setting the decision metric conversion window to be at most 10%
        of the <Text weight="semibold">Update Cadence</Text> to limit metric
        windows extending into periods when users may switch variations.
      </Text>
    </Callout>
  );

  if (showNoFactMetricsMessage) {
    return (
      <>
        <Callout status="info" my="2">
          <Flex direction="column" align="start" gap="2">
            <Text>
              {factTableForMetric
                ? "Add a mean or proportion fact metric to use as the decision metric, then continue."
                : "This data source has no fact metrics. Contextual bandits can only use a mean or proportion fact metric as the decision metric, so create one for this data source before continuing."}
            </Text>
            {factTableForMetric
              ? canCreateFactMetric && (
                  <Button
                    variant="outline"
                    onClick={() => setShowFactMetricModal(true)}
                  >
                    Add fact metric
                  </Button>
                )
              : canCreateFactTable && (
                  <Button
                    variant="outline"
                    onClick={() => setShowFactTableModal(true)}
                  >
                    Add fact table
                  </Button>
                )}
          </Flex>
        </Callout>
        {showFactTableModal && (
          <FactTableModal
            close={() => setShowFactTableModal(false)}
            onCreate={(factTable) => {
              setShowFactTableModal(false);
              setCreatedFactTable(factTable);
            }}
          />
        )}
        {showFactMetricModal && factTableForMetric && (
          <FactMetricModal
            close={() => setShowFactMetricModal(false)}
            initialFactTable={factTableForMetric.id}
            source="contextual-bandit-decision-metric"
            datasource={datasourceId || undefined}
            onSave={() => setShowFactMetricModal(false)}
          />
        )}
      </>
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
        goalMetricAllowedFactMetricTypes={["mean", "proportion"]}
        noLegacyMetrics={true}
        requireDatasource={true}
        experimentType={undefined}
        goalMetricsDescription={" "}
        goalMetrics={decisionMetricId ? [decisionMetricId] : []}
        secondaryMetrics={[]}
        guardrailMetrics={[]}
        setGoalMetrics={(goalMetrics) => {
          const next = goalMetrics[0] ?? "";
          form.setValue("decisionMetric", next);
          if (next) {
            const metric = getExperimentMetricById(next);
            const metricWindow =
              metric?.windowSettings.type === "conversion"
                ? metric.windowSettings
                : null;
            lastMetricDefaultKey.current = `${next}:${
              metricWindow
                ? `${metricWindow.windowValue}:${metricWindow.windowUnit}`
                : "none"
            }`;
            applyConversionWindowDefault(next);
          }
        }}
        disabled={disabled}
      />

      {decisionMetricId ? (
        <Box my="5">
          <Text size="medium" weight="semibold">
            Conversion Window
          </Text>
          <Text size="small" color="text-mid" as="p" my="1">
            Set a short window to ensure the bandit reward is measured before a
            user may switch variations.
          </Text>
          <Text color="text-mid" size="small" as="p" my="1">
            {decisionMetricWindow ? (
              <>
                Metric default: {decisionMetricWindow.windowValue}{" "}
                {decisionMetricWindow.windowValue === 1
                  ? decisionMetricWindow.windowUnit.slice(0, -1)
                  : decisionMetricWindow.windowUnit}
              </>
            ) : (
              "Metric default: No existing metric-level conversion window."
            )}
          </Text>

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
        </Box>
      ) : null}
    </>
  );
}

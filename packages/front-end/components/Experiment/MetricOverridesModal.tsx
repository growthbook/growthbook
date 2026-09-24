import { useForm } from "react-hook-form";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { MetricOverride } from "shared/validators";
import { StatsEngine } from "shared/types/stats";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Callout from "@/ui/Callout";
import { useDefinitions } from "@/services/DefinitionsContext";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useUser } from "@/services/UserContext";
import { getIsExperimentIncludedInIncrementalRefresh } from "@/services/experiments";
import MetricsOverridesSelector from "./MetricsOverridesSelector";
import {
  EditMetricsFormInterface,
  fixMetricOverridesBeforeSaving,
  getDefaultMetricOverridesFormValue,
} from "./EditMetricsForm";

/**
 * The experiment's metric overrides and nothing else: the part of analysis
 * settings a metric's hover card offers, without the rest of that modal.
 * Confirming hands the overrides to the page's draft rather than writing them.
 */
export default function MetricOverridesModal({
  experiment,
  datasource,
  statsEngine,
  metrics,
  overrides,
  close,
  stageChanges,
}: {
  experiment: ExperimentInterfaceStringDates;
  /** The data source as the page currently has it, which may be unsaved. */
  datasource: string;
  /** The engine as the page currently has it, which may be unsaved. */
  statsEngine: StatsEngine;
  /** The metrics as the page currently has them, which may be unsaved. */
  metrics: Pick<
    EditMetricsFormInterface,
    "goalMetrics" | "secondaryMetrics" | "guardrailMetrics" | "activationMetric"
  >;
  overrides: MetricOverride[];
  close: () => void;
  stageChanges: (overrides: MetricOverride[]) => void;
}) {
  const { getExperimentMetricById, getDatasourceById } = useDefinitions();
  const settings = useOrgSettings();
  const { hasCommercialFeature } = useUser();
  // Incremental refresh reuses earlier results, which an override would
  // silently contradict, so the full settings modal locks overrides there too.
  const incremental = getIsExperimentIncludedInIncrementalRefresh(
    getDatasourceById(datasource) ?? undefined,
    experiment.id,
    experiment.type,
  );
  const hasFeature = hasCommercialFeature("override-metrics");
  const canOverride = hasFeature && !incremental;

  const form = useForm<EditMetricsFormInterface>({
    defaultValues: {
      ...metrics,
      metricOverrides: getDefaultMetricOverridesFormValue(
        overrides,
        getExperimentMetricById,
        settings,
      ),
    },
  });

  return (
    <ModalStandard
      open={true}
      close={close}
      trackingEventModalType="edit-metric-overrides"
      header="Metric Overrides"
      subheader="Change how individual metrics are analyzed in this experiment. Anything you don't override follows the metric's own settings."
      cta="Confirm"
      ctaEnabled={canOverride}
      size="lg"
      submit={form.handleSubmit(async (value) => {
        const next = [...(value.metricOverrides ?? [])];
        fixMetricOverridesBeforeSaving(next);
        stageChanges(next);
      })}
    >
      {!hasFeature ? (
        <Callout status="info" mb="3">
          Overriding metrics is available on paid plans.
        </Callout>
      ) : incremental ? (
        <Callout status="info" mb="3">
          Metric overrides aren&apos;t available for experiments using
          incremental refresh.
        </Callout>
      ) : null}
      <MetricsOverridesSelector
        experiment={experiment}
        form={form}
        disabled={!canOverride}
        datasource={datasource}
        statsEngine={statsEngine}
      />
    </ModalStandard>
  );
}

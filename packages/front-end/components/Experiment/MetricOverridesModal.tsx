import { useState } from "react";
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

/** Confirming stages the overrides on the page's draft rather than saving them. */
export default function MetricOverridesModal({
  experiment,
  datasource,
  statsEngine,
  metrics,
  overrides,
  focusMetricIds,
  close,
  stageChanges,
}: {
  experiment: ExperimentInterfaceStringDates;
  // The page's current values for these, which may be unsaved.
  datasource: string;
  statsEngine: StatsEngine;
  metrics: Pick<
    EditMetricsFormInterface,
    "goalMetrics" | "secondaryMetrics" | "guardrailMetrics" | "activationMetric"
  >;
  overrides: MetricOverride[];
  /** With just one, that metric's card opens focused. */
  focusMetricIds?: string[];
  close: () => void;
  stageChanges: (overrides: MetricOverride[]) => void;
}) {
  const { getExperimentMetricById, getDatasourceById } = useDefinitions();
  const settings = useOrgSettings();
  const { hasCommercialFeature } = useUser();
  // Incremental refresh reuses earlier results, which an override would
  // silently contradict.
  const incremental = getIsExperimentIncludedInIncrementalRefresh(
    getDatasourceById(datasource) ?? undefined,
    experiment.id,
    experiment.type,
  );
  const hasFeature = hasCommercialFeature("override-metrics");
  const canOverride = hasFeature && !incremental;

  const [targetId] = useState(() => {
    const id = focusMetricIds?.length === 1 ? focusMetricIds[0] : null;
    return id && overrides.some((o) => o.id === id) ? id : null;
  });

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
      onOpenAutoFocus={(e) => {
        const content = e.currentTarget as HTMLElement;
        const card = targetId
          ? content.querySelector<HTMLElement>(
              `[data-override-metric="${CSS.escape(targetId)}"]`,
            )
          : null;
        // Its first setting, past the header's remove link.
        const field = card?.querySelector<HTMLElement>(
          "tbody button[role='combobox'], tbody input:not([type='hidden'])",
        );
        e.preventDefault();
        if (!field) return content.focus();
        field.focus();
        card?.scrollIntoView({ block: "nearest" });
      }}
      open={true}
      close={close}
      trackingEventModalType="edit-metric-overrides"
      header="Metric Overrides"
      subheader="Change how individual metrics are analyzed in this experiment. Anything you don't override follows the metric's own settings."
      cta="Confirm"
      ctaEnabled={canOverride}
      size="lg"
      submit={form.handleSubmit(async (value) => {
        const next = value.metricOverrides ?? [];
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
        highlightMetricId={targetId}
      />
    </ModalStandard>
  );
}

import { FC, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import {
  ExperimentInterfaceStringDates,
  MetricOverride,
} from "shared/types/experiment";
import cloneDeep from "lodash/cloneDeep";
import {
  DEFAULT_PROPER_PRIOR_STDDEV,
  DEFAULT_REGRESSION_ADJUSTMENT_DAYS,
} from "shared/constants";
import { OrganizationSettings } from "shared/types/organization";
import { ExperimentMetricDefinition } from "shared/experiments";
import { CustomMetricSlice } from "shared/validators";
import { Box, Separator } from "@radix-ui/themes";
import { getScopedSettings } from "shared/settings";
import useOrgSettings from "@/hooks/useOrgSettings";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import UpgradeMessage from "@/components/Marketing/UpgradeMessage";
import UpgradeModal from "@/components/Settings/UpgradeModal";
import track from "@/services/track";
import PremiumCallout from "@/ui/PremiumCallout";
import { getIsExperimentIncludedInIncrementalRefresh } from "@/services/experiments";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { validatedSubmit } from "@/ui/Modal/validatedSubmit";
import MetricsOverridesSelector from "./MetricsOverridesSelector";
import ActivationMetricRow from "./ActivationMetricRow";
import ExperimentMetricsSelector from "./ExperimentMetricsSelector";
import CustomMetricSlicesSelector from "./CustomMetricSlicesSelector";
import {
  AdvancedSection,
  SettingsCard,
} from "./TabbedPage/AnalysisPlanAdvanced";
import SetupFieldRow from "./TabbedPage/SetupFieldRow";

export interface EditMetricsFormInterface {
  goalMetrics: string[];
  secondaryMetrics: string[];
  guardrailMetrics: string[];
  activationMetric: string;
  metricOverrides: MetricOverride[];
  customMetricSlices?: CustomMetricSlice[];
}

export function getDefaultMetricOverridesFormValue(
  overrides: MetricOverride[],
  getExperimentMetricById: (id: string) => ExperimentMetricDefinition | null,
  settings: OrganizationSettings,
) {
  const defaultMetricOverrides = cloneDeep(overrides);
  for (let i = 0; i < defaultMetricOverrides.length; i++) {
    for (const key in defaultMetricOverrides[i]) {
      // fix fields with percentage values
      if (["maxPercentChange", "minPercentChange", "targetMDE"].includes(key)) {
        defaultMetricOverrides[i][key] *= 100;
      }
    }
    if (defaultMetricOverrides[i].regressionAdjustmentDays === undefined) {
      const metricDefinition = getExperimentMetricById(
        defaultMetricOverrides[i].id,
      );
      if (metricDefinition?.regressionAdjustmentOverride) {
        defaultMetricOverrides[i].regressionAdjustmentDays =
          metricDefinition.regressionAdjustmentDays;
      } else {
        defaultMetricOverrides[i].regressionAdjustmentDays =
          settings.regressionAdjustmentDays ??
          DEFAULT_REGRESSION_ADJUSTMENT_DAYS;
      }
    }
    if (
      isNaN(defaultMetricOverrides[i].properPriorMean ?? NaN) ||
      isNaN(defaultMetricOverrides[i].properPriorMean ?? NaN)
    ) {
      const metricDefinition = getExperimentMetricById(
        defaultMetricOverrides[i].id,
      );
      const defaultValues = metricDefinition?.priorSettings?.override
        ? {
            proper: metricDefinition.priorSettings.proper,
            mean: metricDefinition.priorSettings.mean,
            stddev: metricDefinition.priorSettings.stddev,
          }
        : {
            proper: settings.metricDefaults?.priorSettings?.proper ?? false,
            mean: settings.metricDefaults?.priorSettings?.mean ?? 0,
            stddev:
              settings.metricDefaults?.priorSettings?.stddev ??
              DEFAULT_PROPER_PRIOR_STDDEV,
          };

      defaultMetricOverrides[i].properPriorEnabled =
        defaultMetricOverrides[i].properPriorEnabled ?? defaultValues.proper;
      defaultMetricOverrides[i].properPriorMean =
        defaultMetricOverrides[i].properPriorMean ?? defaultValues.mean;
      defaultMetricOverrides[i].properPriorStdDev =
        defaultMetricOverrides[i].properPriorStdDev ?? defaultValues.stddev;
    }
  }
  return defaultMetricOverrides;
}

export function fixMetricOverridesBeforeSaving(overrides: MetricOverride[]) {
  for (let i = 0; i < overrides.length; i++) {
    for (const key in overrides[i]) {
      if (key === "id") continue;
      const v = overrides[i][key];
      // remove nullish values from payload
      if (v === undefined || v === null || (key !== "windowType" && isNaN(v))) {
        delete overrides[i][key];
        continue;
      }
      // fix fields with percentage values
      if (["maxPercentChange", "minPercentChange", "targetMDE"].includes(key)) {
        overrides[i][key] = v / 100;
      }
    }
  }
}

const EditMetricsForm: FC<{
  experiment: ExperimentInterfaceStringDates;
  cancel: () => void;
  mutate: () => void;
  source?: string;
}> = ({ experiment, cancel, mutate, source }) => {
  const [upgradeModal, setUpgradeModal] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const settings = useOrgSettings();
  const { organization, hasCommercialFeature } = useUser();
  const hasOverrideMetricsFeature = hasCommercialFeature("override-metrics");

  const { getDatasourceById, getExperimentMetricById, getProjectById } =
    useDefinitions();
  const statsEngine = getScopedSettings({
    organization,
    project: getProjectById(experiment.project || "") ?? undefined,
    experiment,
  }).settings.statsEngine.value;

  const defaultMetricOverrides = getDefaultMetricOverridesFormValue(
    experiment.metricOverrides || [],
    getExperimentMetricById,
    settings,
  );

  const isBandit = experiment.type === "multi-armed-bandit";
  const isHoldout = experiment.type === "holdout";

  const datasource = getDatasourceById(experiment.datasource);
  const isExperimentIncludedInIncrementalRefresh =
    getIsExperimentIncludedInIncrementalRefresh(
      datasource ?? undefined,
      experiment.id,
      experiment.type,
    );

  const form = useForm<EditMetricsFormInterface>({
    defaultValues: {
      goalMetrics: experiment.goalMetrics || [],
      secondaryMetrics: experiment.secondaryMetrics || [],
      guardrailMetrics: experiment.guardrailMetrics || [],
      activationMetric: experiment.activationMetric || "",
      metricOverrides: defaultMetricOverrides,
      customMetricSlices: experiment.customMetricSlices || [],
    },
  });
  const { apiCall } = useAuth();
  useEffect(() => {
    track("edit-metric-form-open");
  });
  if (upgradeModal) {
    return (
      <UpgradeModal
        close={() => setUpgradeModal(false)}
        source="override-metrics"
        commercialFeature="override-metrics"
      />
    );
  }

  return (
    <ModalStandard
      trackingEventModalType="edit-metrics-form"
      trackingEventModalSource={source}
      header="Edit Metrics"
      size="lg"
      open={true}
      close={cancel}
      submit={validatedSubmit(form, async (value) => {
        const payload = cloneDeep<EditMetricsFormInterface>(value);
        fixMetricOverridesBeforeSaving(value.metricOverrides || []);
        await apiCall(`/experiment/${experiment.id}`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        mutate();
      })}
    >
      <ExperimentMetricsSelector
        asRows
        datasource={experiment.datasource}
        exposureQueryId={experiment.exposureQueryId}
        exposureQueryIdentifierType={experiment.exposureQueryIdentifierType}
        project={experiment.project}
        goalMetrics={form.watch("goalMetrics")}
        secondaryMetrics={form.watch("secondaryMetrics")}
        guardrailMetrics={form.watch("guardrailMetrics")}
        setGoalMetrics={
          !(isBandit && experiment.status === "running")
            ? (goalMetrics) => form.setValue("goalMetrics", goalMetrics)
            : undefined
        }
        setSecondaryMetrics={(secondaryMetrics) =>
          form.setValue("secondaryMetrics", secondaryMetrics)
        }
        setGuardrailMetrics={
          !isHoldout
            ? (guardrailMetrics) =>
                form.setValue("guardrailMetrics", guardrailMetrics)
            : undefined
        }
        filterConversionWindowMetrics={isHoldout}
        experimentId={experiment.id}
        experimentType={experiment.type}
      />
      {/* If the org has the feature, we render a callout within MetricsSelector */}
      {!hasCommercialFeature("metric-groups") ? (
        <PremiumCallout
          commercialFeature="metric-groups"
          dismissible={true}
          id="metrics-list-metric-group-promo"
          docSection="metricGroups"
          mb="4"
        >
          <strong>Metric Groups</strong> make it possible to reuse sets of
          metrics in your experiments.
        </PremiumCallout>
      ) : null}

      {!isHoldout && !(isBandit && experiment.status === "running") ? (
        <>
          <ActivationMetricRow
            datasource={experiment.datasource}
            exposureQueryId={experiment.exposureQueryId}
            exposureQueryIdentifierType={experiment.exposureQueryIdentifierType}
            project={experiment.project}
            value={form.watch("activationMetric")}
            onChange={(metric) => form.setValue("activationMetric", metric)}
            incrementalRefresh={isExperimentIncludedInIncrementalRefresh}
          />

          <CustomMetricSlicesSelector
            asRow
            goalMetrics={form.watch("goalMetrics")}
            secondaryMetrics={form.watch("secondaryMetrics")}
            guardrailMetrics={form.watch("guardrailMetrics")}
            customMetricSlices={
              (form.watch("customMetricSlices") as CustomMetricSlice[]) || []
            }
            setCustomMetricSlices={(slices) =>
              form.setValue(
                "customMetricSlices" as keyof EditMetricsFormInterface,
                slices,
              )
            }
          />

          <Box>
            <Separator size="4" my="5" />
            <AdvancedSection open={advancedOpen} setOpen={setAdvancedOpen}>
              <SettingsCard title="Metrics">
                <SetupFieldRow
                  label="Metric overrides"
                  tooltip="Override metric behaviors within this experiment."
                  stacked
                >
                  <MetricsOverridesSelector
                    experiment={experiment}
                    form={form}
                    statsEngine={statsEngine}
                    disabled={
                      !hasOverrideMetricsFeature ||
                      isExperimentIncludedInIncrementalRefresh
                    }
                  />
                  {!hasOverrideMetricsFeature && (
                    <UpgradeMessage
                      showUpgradeModal={() => setUpgradeModal(true)}
                      commercialFeature="override-metrics"
                      upgradeMessage="override metrics"
                    />
                  )}
                </SetupFieldRow>
              </SettingsCard>
            </AdvancedSection>
          </Box>
        </>
      ) : null}
    </ModalStandard>
  );
};

export default EditMetricsForm;

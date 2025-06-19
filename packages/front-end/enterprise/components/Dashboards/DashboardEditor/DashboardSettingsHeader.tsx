import React from "react";
import { Flex } from "@radix-ui/themes";
import { ExperimentMetricInterface } from "shared/experiments";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import SelectField from "@/components/Forms/SelectField";
import { useDefinitions } from "@/services/DefinitionsContext";
import DimensionChooser from "@/components/Dimensions/DimensionChooser";
import { useDashboardSettings } from "../DashboardSettingsProvider";

export function ExperimentMetricSelector({
  disabled,
  label,
  metricId,
  setMetricId,
  experiment,
}: {
  disabled?: boolean;
  label?: string;
  metricId: string;
  setMetricId: (metricId: string) => void;
  experiment: ExperimentInterfaceStringDates;
}) {
  const { getExperimentMetricById } = useDefinitions();

  const goalMetrics = experiment.goalMetrics
    .map((id) => getExperimentMetricById(id))
    .filter(Boolean) as ExperimentMetricInterface[];
  const secondaryMetrics = experiment.secondaryMetrics
    .map((id) => getExperimentMetricById(id))
    .filter(Boolean) as ExperimentMetricInterface[];
  const guardrailMetrics = experiment.guardrailMetrics
    .map((id) => getExperimentMetricById(id))
    .filter(Boolean) as ExperimentMetricInterface[];
  const metricOptions = [
    {
      label: "Goal Metrics",
      options: goalMetrics.map((m) => ({ label: m.name, value: m.id })),
    },
    {
      label: "Secondary Metrics",
      options: secondaryMetrics.map((m) => ({ label: m.name, value: m.id })),
    },
    {
      label: "Guardrail Metrics",
      options: guardrailMetrics.map((m) => ({ label: m.name, value: m.id })),
    },
  ];

  return (
    <div>
      <div className="uppercase-title text-muted">{label}</div>
      <SelectField
        disabled={disabled}
        containerClassName="select-dropdown-underline"
        value={metricId}
        placeholder="Select a Metric"
        options={metricOptions}
        onChange={setMetricId}
      />
    </div>
  );
}

export default function DashboardSettingsHeader({
  experiment,
}: {
  experiment: ExperimentInterfaceStringDates;
}) {
  const {
    defaultMetricId,
    defaultSnapshotSettings: { dimensionId },
    setDefaultMetricId,
    setDefaultDimensionId,
    setBaselineRow,
    setDifferenceType,
  } = useDashboardSettings();

  return (
    <div className="appbox p-4">
      <h4 className="text-capitalize">Dashboard Settings</h4>
      <Flex align="center" gap="3">
        <ExperimentMetricSelector
          label="Default Metric"
          metricId={defaultMetricId}
          experiment={experiment}
          setMetricId={setDefaultMetricId}
        />
        <DimensionChooser
          value={dimensionId}
          setValue={setDefaultDimensionId}
          datasourceId={experiment.datasource}
          exposureQueryId={experiment.exposureQueryId}
          newUi={true}
          // setVariationFilter={setVariationFilter}
          setBaselineRow={setBaselineRow}
          setDifferenceType={setDifferenceType}
          // setAnalysisSettings={(
          //   settings: ExperimentSnapshotAnalysisSettings | null
          // ) => {}}
          // ssrPolyfills?={SSRPolyfills}
        />
      </Flex>
    </div>
  );
}

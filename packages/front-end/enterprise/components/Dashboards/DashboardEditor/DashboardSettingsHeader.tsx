import React, { useMemo } from "react";
import { Flex } from "@radix-ui/themes";
import { ExperimentMetricInterface } from "shared/experiments";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import SelectField from "@/components/Forms/SelectField";
import { useDefinitions } from "@/services/DefinitionsContext";
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
    <div className="mb-3">
      <SelectField
        disabled={disabled}
        label={label}
        value={metricId}
        placeholder="Select a Metric"
        options={metricOptions}
        onChange={setMetricId}
      />
    </div>
  );
}

export default function DashboardSettingsHeader({
  isEditing,
  experiment,
}: {
  isEditing: boolean;
  experiment: ExperimentInterfaceStringDates;
}) {
  const { dimensions } = useDefinitions();
  const {
    defaultMetricId,
    setDefaultMetricId,
    defaultDimensionId,
    setDefaultDimensionId,
  } = useDashboardSettings();
  const dimensionOptions = useMemo(
    () => dimensions.map(({ id, name }) => ({ label: name, value: id })),
    [dimensions]
  );

  return (
    <Flex align="center" gap="1">
      <ExperimentMetricSelector
        disabled={!isEditing}
        label="Default Metric"
        metricId={defaultMetricId}
        experiment={experiment}
        setMetricId={setDefaultMetricId}
      />
      <SelectField
        disabled={!isEditing}
        label="Default Dimension"
        value={defaultDimensionId}
        options={dimensionOptions}
        onChange={setDefaultDimensionId}
      />
    </Flex>
  );
}

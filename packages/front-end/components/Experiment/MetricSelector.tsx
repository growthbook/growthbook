import { FC } from "react";
import { isProjectListValidForProject } from "shared/util";
import { useDefinitions } from "@/services/DefinitionsContext";
import SelectField, { SelectFieldProps } from "@/components/Forms/SelectField";
import FactBadge from "../FactTables/FactBadge";
import OfficialBadge from "../Metrics/OfficialBadge";

type MetricOption = {
  id: string;
  name: string;
  datasource: string;
  tags: string[];
  projects: string[];
  factTables: string[];
  isBinomial: boolean;
};

const MetricSelector: FC<
  Omit<SelectFieldProps, "options"> & {
    datasource?: string;
    project?: string;
    includeFacts?: boolean;
    availableIds?: string[];
    onlyBinomial?: boolean;
  }
> = ({
  datasource,
  project,
  includeFacts,
  placeholder,
  availableIds,
  onlyBinomial,
  ...selectProps
}) => {
  const { metrics, factMetrics, getExperimentMetricById } = useDefinitions();

  const options: MetricOption[] = [
    ...metrics.map((m) => ({
      id: m.id,
      name: m.name,
      datasource: m.datasource || "",
      tags: m.tags || [],
      projects: m.projects || [],
      factTables: [],
      isBinomial: m.type === "binomial" && !m.denominator,
    })),
    ...(includeFacts
      ? factMetrics.map((m) => ({
          id: m.id,
          name: m.name,
          datasource: m.datasource,
          tags: m.tags || [],
          projects: m.projects || [],
          factTables: [
            m.numerator.factTableId,
            (m.metricType === "ratio" && m.denominator
              ? m.denominator.factTableId
              : "") || "",
          ],
          isBinomial: m.metricType === "proportion",
        }))
      : []),
  ];

  const filteredOptions = options
    .filter((m) => !availableIds || availableIds.includes(m.id))
    .filter((m) => (datasource ? m.datasource === datasource : true))
    .filter((m) => !onlyBinomial || m.isBinomial)
    .filter((m) => isProjectListValidForProject(m.projects, project));

  return (
    <SelectField
      placeholder={placeholder ?? "Select metric..."}
      {...selectProps}
      options={filteredOptions.map((m) => {
        return {
          value: m.id,
          label: m.name,
        };
      })}
      formatOptionLabel={({ label, value }) => {
        const m = getExperimentMetricById(value);
        return (
          <>
            {label}
            <FactBadge metricId={value} />
            {m?.official ? <OfficialBadge type="Metric" /> : null}
          </>
        );
      }}
    />
  );
};

export default MetricSelector;

import { FC } from "react";
import { isProjectListValidForProject } from "shared/util";
import { useDefinitions } from "@/services/DefinitionsContext";
import SelectField, { SelectFieldProps } from "@/components/Forms/SelectField";
import FactBadge from "../FactTables/FactBadge";
import { isMetricJoinable } from "./MetricsSelector";

type MetricOption = {
  id: string;
  name: string;
  datasource: string;
  tags: string[];
  projects: string[];
  factTables: string[];
  userIdTypes: string[];
  isBinomial: boolean;
};

const MetricSelector: FC<
  Omit<SelectFieldProps, "options"> & {
    datasource?: string;
    exposureQueryId?: string;
    project?: string;
    includeFacts?: boolean;
    availableIds?: string[];
    onlyBinomial?: boolean;
  }
> = ({
  datasource,
  exposureQueryId,
  project,
  includeFacts,
  placeholder,
  availableIds,
  onlyBinomial,
  ...selectProps
}) => {
  const {
    metrics,
    factMetrics,
    factTables,
    getDatasourceById,
  } = useDefinitions();

  const options: MetricOption[] = [
    ...metrics.map((m) => ({
      id: m.id,
      name: m.name,
      datasource: m.datasource || "",
      tags: m.tags || [],
      projects: m.projects || [],
      factTables: [],
      userIdTypes: m.userIdTypes || [],
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
          // only focus on numerator user id types
          userIdTypes:
            factTables.find((f) => f.id === m.numerator.factTableId)
              ?.userIdTypes || [],
          isBinomial: m.metricType === "proportion",
        }))
      : []),
  ];

  // get data to help filter metrics to those with joinable userIdTypes to
  // the experiment assignment table
  const datasourceObj = datasource ? getDatasourceById(datasource) : null;
  const userIdType = datasourceObj?.settings?.queries?.exposure?.find(
    (e) => e.id === exposureQueryId
  )?.userIdType;
  const joinQueries = datasourceObj?.settings?.queries?.identityJoins || [];

  const filteredOptions = options
    .filter((m) => !availableIds || availableIds.includes(m.id))
    .filter((m) => (datasource ? m.datasource === datasource : true))
    .filter((m) => !onlyBinomial || m.isBinomial)
    .filter((m) =>
      userIdType && m.userIdTypes.length
        ? isMetricJoinable(m.userIdTypes, userIdType, joinQueries)
        : true
    )
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
        return (
          <>
            {label}
            <FactBadge metricId={value} />
          </>
        );
      }}
    />
  );
};

export default MetricSelector;

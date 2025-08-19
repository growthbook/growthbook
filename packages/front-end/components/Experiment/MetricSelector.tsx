import { FC } from "react";
import { isProjectListValidForProject } from "shared/util";
import { isBinomialMetric, isMetricJoinable } from "shared/experiments";
import { useDefinitions } from "@/services/DefinitionsContext";
import SelectField, { SelectFieldProps } from "@/components/Forms/SelectField";
import MetricName from "@/components/Metrics/MetricName";

export type MetricOption = {
  id: string;
  name: string;
  datasource: string;
  tags: string[];
  projects: string[];
  factTables: string[];
  userIdTypes: string[];
  isBinomial: boolean;
  isConversionWindowMetric: boolean;
};

const MetricSelector: FC<
  Omit<SelectFieldProps, "options"> & {
    datasource?: string;
    exposureQueryId?: string;
    project?: string;
    projects?: string[]; // will only filter if project is not set
    includeFacts?: boolean;
    availableIds?: string[];
    onlyBinomial?: boolean;
    filterConversionWindowMetrics?: boolean;
    sortMetrics?: (a: MetricOption, b: MetricOption) => number;
    filterMetrics?: (m: MetricOption) => boolean;
    onPaste?: (e: React.ClipboardEvent<HTMLInputElement>) => void;
  }
> = ({
  datasource,
  exposureQueryId,
  project,
  projects,
  includeFacts,
  placeholder,
  availableIds,
  onlyBinomial,
  filterConversionWindowMetrics,
  sortMetrics,
  filterMetrics,
  onPaste,
  ...selectProps
}) => {
  const { metrics, factMetrics, factTables, getDatasourceById } =
    useDefinitions();

  const options: MetricOption[] = [
    ...metrics.map((m) => ({
      id: m.id,
      name: m.name,
      datasource: m.datasource || "",
      tags: m.tags || [],
      projects: m.projects || [],
      factTables: [],
      userIdTypes: m.userIdTypes || [],
      isBinomial: isBinomialMetric(m) && !m.denominator,
      isConversionWindowMetric: m?.windowSettings?.type === "conversion",
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
          isBinomial: isBinomialMetric(m),
          isConversionWindowMetric: m?.windowSettings?.type === "conversion",
        }))
      : []),
  ].filter((m) => (filterMetrics ? filterMetrics(m) : true));

  if (sortMetrics) {
    options.sort(sortMetrics);
    selectProps.sort = false;
  }

  // get data to help filter metrics to those with joinable userIdTypes to
  // the experiment assignment table
  const datasourceSettings = datasource
    ? getDatasourceById(datasource)?.settings
    : undefined;
  const userIdType = datasourceSettings?.queries?.exposure?.find(
    (e) => e.id === exposureQueryId,
  )?.userIdType;

  const filteredOptions = options
    .filter((m) => !availableIds || availableIds.includes(m.id))
    .filter((m) => (datasource ? m.datasource === datasource : true))
    .filter((m) => !onlyBinomial || m.isBinomial)
    .filter((m) =>
      userIdType && m.userIdTypes.length
        ? isMetricJoinable(m.userIdTypes, userIdType, datasourceSettings)
        : true,
    )
    .filter((m) => {
      if (projects && !project) {
        return (
          !projects.length ||
          projects.some((p) => isProjectListValidForProject(m.projects, p))
        );
      }
      return isProjectListValidForProject(m.projects, project);
    })
    .filter((m) => {
      if (filterConversionWindowMetrics) {
        return !m.isConversionWindowMetric;
      }
      return true;
    });

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
      formatOptionLabel={({ value, label }) => {
        return value ? <MetricName id={value} /> : label;
      }}
      onPaste={onPaste}
    />
  );
};

export default MetricSelector;

import { FC } from "react";
import { isProjectListValidForProject } from "shared/util";
import {
  getFactMetricFactTableIds,
  isBinomialMetric,
  isFactFunnelMetric,
  isFactMetricJoinable,
  isMetricJoinable,
} from "shared/experiments";
import { useDefinitions } from "@/services/DefinitionsContext";
import { getExposureQueryIdentifierType } from "@/services/datasources";
import SelectField, { SelectFieldProps } from "@/components/Forms/SelectField";
import MetricName from "@/components/Metrics/MetricName";

export type MetricOption = {
  id: string;
  name: string;
  datasource: string;
  tags: string[];
  projects: string[];
  factTables: string[];
  joinable: boolean;
  isBinomial: boolean;
  isConversionWindowMetric: boolean;
  isFactFunnelMetric: boolean;
};

const MetricSelector: FC<
  Omit<SelectFieldProps, "options"> & {
    datasource?: string;
    exposureQueryId?: string;
    exposureQueryIdentifierType?: string;
    project?: string;
    projects?: string[]; // will only filter if project is not set
    includeFacts?: boolean;
    availableIds?: string[];
    onlyBinomial?: boolean;
    filterConversionWindowMetrics?: boolean;
    filterFactFunnelMetrics?: boolean;
    sortMetrics?: (a: MetricOption, b: MetricOption) => number;
    filterMetrics?: (m: MetricOption) => boolean;
    onPaste?: (e: React.ClipboardEvent<HTMLInputElement>) => void;
  }
> = ({
  datasource,
  exposureQueryId,
  exposureQueryIdentifierType,
  project,
  projects,
  includeFacts,
  placeholder,
  availableIds,
  onlyBinomial,
  filterConversionWindowMetrics,
  filterFactFunnelMetrics,
  sortMetrics,
  filterMetrics,
  onPaste,
  ...selectProps
}) => {
  const { metrics, factMetrics, getFactTableById, getDatasourceById } =
    useDefinitions();

  // get data to help filter metrics to those with joinable userIdTypes to
  // the experiment assignment table
  const datasourceSettings = datasource
    ? getDatasourceById(datasource)?.settings
    : undefined;
  const exposureQuery = datasourceSettings?.queries?.exposure?.find(
    (e) => e.id === exposureQueryId,
  );
  const userIdType = exposureQuery
    ? getExposureQueryIdentifierType(exposureQuery, exposureQueryIdentifierType)
    : undefined;

  const options: MetricOption[] = [
    ...metrics.map((m) => ({
      id: m.id,
      name: m.name,
      datasource: m.datasource || "",
      tags: m.tags || [],
      projects: m.projects || [],
      factTables: [],
      joinable:
        !userIdType || !(m.userIdTypes || []).length
          ? true
          : isMetricJoinable(
              m.userIdTypes || [],
              userIdType,
              datasourceSettings,
            ),
      isBinomial: isBinomialMetric(m) && !m.denominator,
      isFactFunnelMetric: isFactFunnelMetric(m),
      isConversionWindowMetric: m?.windowSettings?.type === "conversion",
    })),
    ...(includeFacts
      ? factMetrics.map((m) => ({
          id: m.id,
          name: m.name,
          datasource: m.datasource,
          tags: m.tags || [],
          projects: m.projects || [],
          factTables: getFactMetricFactTableIds(m),
          joinable: !userIdType
            ? true
            : isFactMetricJoinable(
                m,
                userIdType,
                getFactTableById,
                datasourceSettings,
              ),
          isBinomial: isBinomialMetric(m),
          isFactFunnelMetric: isFactFunnelMetric(m),
          isConversionWindowMetric: m?.windowSettings?.type === "conversion",
        }))
      : []),
  ].filter((m) => (filterMetrics ? filterMetrics(m) : true));

  if (sortMetrics) {
    options.sort(sortMetrics);
    selectProps.sort = false;
  }

  const filteredOptions = options
    .filter((m) => !availableIds || availableIds.includes(m.id))
    .filter((m) => (datasource ? m.datasource === datasource : true))
    .filter((m) => !onlyBinomial || m.isBinomial)
    .filter((m) => !filterFactFunnelMetrics || !m.isFactFunnelMetric)
    .filter((m) => m.joinable)
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
      size="legacy"
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

import { FC } from "react";
import {
  resolveAnalysisIdentifierType,
  isProjectListValidForProject,
} from "shared/util";
import {
  getFactMetricFactTableIds,
  isBinomialMetric,
  isFactFunnelMetric,
  isFactMetricJoinable,
  isMetricJoinable,
} from "shared/experiments";
import { useDefinitions } from "@/services/DefinitionsContext";
import SelectField, { SelectFieldProps } from "@/components/Forms/SelectField";
import MetricName from "@/components/Metrics/MetricName";
import { ArchivedLabel } from "@/components/Experiment/MetricsSelector";

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
  archived?: boolean;
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
  const {
    metrics,
    _metricsIncludingArchived,
    factMetrics,
    _factMetricsIncludingArchived,
    getFactTableById,
    getDatasourceById,
  } = useDefinitions();

  // Keep an archived selection as an option so it still displays.
  const selectedId = selectProps.value;
  const selectionIsArchived =
    !!selectedId &&
    !metrics.some((m) => m.id === selectedId) &&
    !factMetrics.some((m) => m.id === selectedId);
  const legacyMetrics = selectionIsArchived
    ? [
        ...metrics,
        ..._metricsIncludingArchived.filter((m) => m.id === selectedId),
      ]
    : metrics;
  const factMetricsWithSelected = selectionIsArchived
    ? [
        ...factMetrics,
        ..._factMetricsIncludingArchived.filter((m) => m.id === selectedId),
      ]
    : factMetrics;

  // get data to help filter metrics to those with joinable userIdTypes to
  // the experiment assignment table
  const datasourceSettings = datasource
    ? getDatasourceById(datasource)?.settings
    : undefined;
  const exposureQuery = datasourceSettings?.queries?.exposure?.find(
    (e) => e.id === exposureQueryId,
  );
  const userIdType = exposureQuery
    ? resolveAnalysisIdentifierType(exposureQuery, exposureQueryIdentifierType)
    : undefined;

  const options: MetricOption[] = [
    ...legacyMetrics.map((m) => ({
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
      archived: selectionIsArchived && m.id === selectedId,
    })),
    ...(includeFacts
      ? factMetricsWithSelected.map((m) => ({
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
          archived: selectionIsArchived && m.id === selectedId,
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
        if (!value) return label;
        return (
          <ArchivedLabel archived={selectionIsArchived && value === selectedId}>
            <MetricName id={value} />
          </ArchivedLabel>
        );
      }}
      onPaste={onPaste}
    />
  );
};

export default MetricSelector;

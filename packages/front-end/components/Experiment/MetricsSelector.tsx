import React, { FC, ReactNode, useState } from "react";
import { isProjectListValidForProject } from "shared/util";
import {
  isFactMetric,
  isMetricGroupId,
  isMetricJoinable,
  quantileMetricType,
} from "shared/experiments";
import { Flex, Text } from "@radix-ui/themes";
import { PiInfoFill } from "react-icons/pi";
import { useDefinitions } from "@/services/DefinitionsContext";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import SelectField, {
  GroupedValue,
  SingleValue,
} from "@/components/Forms/SelectField";
import Tooltip from "@/components/Tooltip/Tooltip";
import MetricName from "@/components/Metrics/MetricName";
import ClickToCopy from "@/components/Settings/ClickToCopy";
import { GBInfo } from "@/components/Icons";
import { useUser } from "@/services/UserContext";
import MetricGroupInlineForm from "@/enterprise/components/MetricGroupInlineForm";
import Link from "@/ui/Link";

type MetricOption = {
  id: string;
  name: string;
  description: string;
  datasource: string;
  tags: string[];
  projects: string[];
  factTables: string[];
  userIdTypes: string[];
  isGroup: boolean;
  metrics?: string[];
  managedBy?: string;
  disabled?: boolean;
  disabledReason?: string;
};

type MetricsSelectorTooltipProps = {
  onlyBinomial?: boolean;
  noQuantileGoalMetrics?: boolean;
  isSingular?: boolean;
};

export const MetricsSelectorTooltip = ({
  onlyBinomial = false,
  noQuantileGoalMetrics = false,
  isSingular = false,
}: MetricsSelectorTooltipProps) => {
  return (
    <Tooltip
      body={
        <>
          You can only select {isSingular ? "a single metric" : "metrics"} that
          fit{isSingular ? "s" : ""} all criteria below:
          <ul>
            <li>
              {isSingular ? "is" : "are"} from the same Data Source as the
              experiment
            </li>
            <li>
              either share{isSingular ? "s" : ""} an Identifier Type with the
              Experiment Assignment Table or can be joined to it by a Join Table
            </li>
            {onlyBinomial ? (
              <li>{isSingular ? "is" : "are"} a binomial metric</li>
            ) : null}
            {noQuantileGoalMetrics ? (
              <li>
                {isSingular
                  ? "is not a quantile metric"
                  : "are not quantile metrics"}
              </li>
            ) : null}
          </ul>
        </>
      }
    />
  );
};

const MetricsSelector: FC<{
  datasource?: string;
  project?: string;
  exposureQueryId?: string;
  selected: string[];
  onChange: (metrics: string[]) => void;
  autoFocus?: boolean;
  includeFacts?: boolean;
  includeGroups?: boolean;
  excludeQuantiles?: boolean;
  forceSingleMetric?: boolean;
  noManual?: boolean;
  noLegacyMetrics?: boolean;
  filterConversionWindowMetrics?: boolean;
  disabled?: boolean;
  helpText?: ReactNode;
  groupOptions?: boolean;
  getMetricDisabledInfo?: (
    metricId: string,
    isGroup: boolean,
  ) => {
    disabled: boolean;
    reason?: string;
  };
}> = ({
  datasource,
  project,
  exposureQueryId,
  selected,
  onChange,
  autoFocus,
  includeFacts,
  includeGroups = true,
  excludeQuantiles,
  forceSingleMetric = false,
  noManual = false,
  noLegacyMetrics = false,
  filterConversionWindowMetrics,
  disabled,
  helpText,
  groupOptions = true,
  getMetricDisabledInfo,
}) => {
  const [createMetricGroup, setCreateMetricGroup] = useState(false);
  const {
    metrics,
    metricGroups,
    factMetrics,
    factTables,
    getExperimentMetricById,
    getDatasourceById,
    mutateDefinitions,
  } = useDefinitions();
  const { hasCommercialFeature } = useUser();

  const metricListContainsGroup = selected.some((metric) =>
    isMetricGroupId(metric),
  );

  const options: MetricOption[] = [
    ...(noLegacyMetrics ? [] : metrics)
      .filter((m) => {
        if (filterConversionWindowMetrics) {
          return m?.windowSettings?.type !== "conversion";
        }
        return true;
      })
      .filter((m) => (noManual ? m.datasource : true))
      .map((m) => {
        const disabledInfo = getMetricDisabledInfo?.(m.id, false) || {
          disabled: false,
        };
        return {
          id: m.id,
          name: m.name,
          description: m.description || "",
          datasource: m.datasource || "",
          tags: m.tags || [],
          projects: m.projects || [],
          factTables: [],
          userIdTypes: m.userIdTypes || [],
          isGroup: false,
          managedBy: m.managedBy,
          disabled: disabledInfo.disabled,
          disabledReason: disabledInfo.reason,
        };
      }),
    ...(includeFacts
      ? factMetrics
          .filter((m) => {
            if (quantileMetricType(m) && excludeQuantiles) {
              return false;
            }
            if (filterConversionWindowMetrics) {
              return m?.windowSettings?.type !== "conversion";
            }
            return true;
          })
          .map((m) => {
            const disabledInfo = getMetricDisabledInfo?.(m.id, false) || {
              disabled: false,
            };
            return {
              id: m.id,
              name: m.name,
              description: m.description || "",
              datasource: m.datasource,
              tags: m.tags || [],
              projects: m.projects || [],
              managedBy: m.managedBy,
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
              isGroup: false,
              disabled: disabledInfo.disabled,
              disabledReason: disabledInfo.reason,
            };
          })
      : []),
    ...(includeGroups
      ? metricGroups
          .filter((mg) => !mg.archived)
          .map((mg) => {
            const disabledInfo = getMetricDisabledInfo?.(mg.id, true) || {
              disabled: false,
            };
            return {
              id: mg.id,
              name: mg.name + " (" + mg.metrics.length + " metrics)",
              description: mg.description || "",
              datasource: mg.datasource,
              tags: mg.tags || [],
              projects: mg.projects || [],
              factTables: [],
              userIdTypes: [],
              isGroup: true,
              metrics: mg.metrics,
              disabled: disabledInfo.disabled,
              disabledReason: disabledInfo.reason,
            };
          })
      : []),
  ];

  // get data to help filter metrics to those with joinable userIdTypes to
  // the experiment assignment table
  const datasourceSettings = datasource
    ? getDatasourceById(datasource)?.settings
    : undefined;
  // todo: get specific exposure query from experiment?
  const userIdType = datasourceSettings?.queries?.exposure?.find(
    (e) => e.id === exposureQueryId,
  )?.userIdType;

  const filteredOptions = options
    .filter((m) => (datasource ? m.datasource === datasource : true))
    .filter((m) =>
      datasourceSettings && userIdType && m.userIdTypes.length
        ? isMetricJoinable(m.userIdTypes, userIdType, datasourceSettings)
        : true,
    )
    .filter((m) => isProjectListValidForProject(m.projects, project));

  const isOptionDisabled = (option: SingleValue | GroupedValue): boolean => {
    if ("options" in option) {
      return false;
    }

    const metricOption = filteredOptions.find((m) => m.id === option.value);
    return metricOption?.disabled ?? false;
  };

  const tagCounts: Record<string, number> = {};
  filteredOptions.forEach((m) => {
    if (!selected.includes(m.id) && m.tags) {
      m.tags.forEach((t) => {
        tagCounts[t] = tagCounts[t] || 0;
        tagCounts[t]++;
      });
    }
  });

  let showMetricGroupHelper =
    hasCommercialFeature("metric-groups") &&
    selected.length >= 2 &&
    !metricListContainsGroup &&
    datasource;

  // Disable this for now since it is making the UI too cluttered
  // We will revisit when we re-design the metric selector
  showMetricGroupHelper = false;

  const selector = !forceSingleMetric ? (
    <MultiSelectField
      value={selected}
      onChange={onChange}
      customStyles={{
        group: groupOptions
          ? (base, state) => ({
              ...base,
              borderBottom:
                state.selectProps.options?.length >= 1 &&
                state.selectProps.options[0] === state.data
                  ? "1px solid #e9ecef"
                  : "none",
            })
          : undefined,
      }}
      options={
        groupOptions
          ? (() => {
              const groupedOptions: GroupedValue[] = [];
              const managedMetrics: SingleValue[] = [];
              const unManagedMetrics: SingleValue[] = [];

              filteredOptions.forEach((option) => {
                const tooltipText =
                  option.disabled && option.disabledReason
                    ? option.disabledReason
                    : option.description;

                const singleValue: SingleValue = {
                  value: option.id,
                  label: option.name,
                  tooltip: tooltipText,
                };

                if (option.managedBy) {
                  managedMetrics.push(singleValue);
                } else {
                  unManagedMetrics.push(singleValue);
                }
              });

              if (managedMetrics.length > 0) {
                groupedOptions.push({
                  label: "",
                  options: managedMetrics,
                });
              }

              if (unManagedMetrics.length > 0) {
                groupedOptions.push({
                  label: "",
                  options: unManagedMetrics,
                });
              }

              return groupedOptions;
            })()
          : filteredOptions.map((m) => {
              const tooltipText =
                m.disabled && m.disabledReason
                  ? `${m.description || ""}\n\n${m.disabledReason}`.trim()
                  : m.description;

              return {
                value: m.id,
                label: m.name,
                tooltip: tooltipText,
              };
            })
      }
      placeholder="Select metrics..."
      autoFocus={autoFocus}
      isOptionDisabled={isOptionDisabled}
      formatOptionLabel={({ value, label }, { context }) => {
        const option = filteredOptions.find((o) => o.id === value);
        const isGroup = option?.isGroup;
        const metricsWithJoinableStatus = isGroup
          ? option?.metrics?.map((m) => {
              const metric = getExperimentMetricById(m);
              if (!metric) return { metric, joinable: false };
              const userIdTypes = isFactMetric(metric)
                ? factTables.find((f) => f.id === metric.numerator.factTableId)
                    ?.userIdTypes || []
                : metric.userIdTypes || [];
              return {
                metric,
                joinable:
                  userIdType && userIdTypes.length
                    ? isMetricJoinable(
                        userIdTypes,
                        userIdType,
                        datasourceSettings,
                      )
                    : true,
              };
            })
          : [];
        return value ? (
          <MetricName
            id={value}
            showDescription={context !== "value"}
            isGroup={isGroup}
            metrics={metricsWithJoinableStatus}
            filterConversionWindowMetrics={filterConversionWindowMetrics}
            badgeColor={
              context !== "value" ? "var(--blue-11)" : "var(--violet-11)"
            }
            officialBadgePosition="left"
          />
        ) : (
          label
        );
      }}
      onPaste={(e) => {
        try {
          const clipboard = e.clipboardData;
          const data = JSON.parse(clipboard.getData("Text"));
          if (
            data.every(
              (d) =>
                d.startsWith("met_") ||
                d.startsWith("mg_") ||
                d.startsWith("fact__"),
            )
          ) {
            e.preventDefault();
            e.stopPropagation();
            onChange(data);
          }
        } catch (e) {
          // fail silently
        }
      }}
      disabled={disabled}
      helpText={
        <>
          {helpText}
          {showMetricGroupHelper && datasource ? (
            <Flex align="center">
              {createMetricGroup ? (
                <MetricGroupInlineForm
                  selectedMetricIds={selected}
                  datasource={datasource}
                  mutateDefinitions={mutateDefinitions}
                  onChange={onChange}
                  cancel={() => setCreateMetricGroup(false)}
                />
              ) : (
                <>
                  <PiInfoFill size="13" style={{ color: "var(--violet-11)" }} />
                  <Text className="px-1" style={{ color: "var(--violet-11)" }}>
                    Create a Metric Group so you can easily re-use this set of
                    metrics in other experiments.
                  </Text>
                  <Link
                    role="button"
                    onClick={() => setCreateMetricGroup(true)}
                  >
                    <strong style={{ textDecoration: "underline" }}>
                      Convert now
                    </strong>
                  </Link>
                </>
              )}
            </Flex>
          ) : null}
          <div className="d-flex align-items-center justify-content-start mt-2 mb-2">
            <div>
              {!forceSingleMetric &&
                filteredOptions.length > 0 &&
                !disabled && (
                  <div className="metric-from-tag text-muted form-inline">
                    <span
                      style={{
                        color: "var(--violet-11)",
                        fontWeight: 600,
                      }}
                    >
                      Select metric by tag:{" "}
                      <Tooltip body="Metrics can be tagged for grouping. Select any tag to add all metrics associated with that tag.">
                        <GBInfo />
                      </Tooltip>
                    </span>
                    <SelectField
                      value="choose"
                      placeholder="choose"
                      className="ml-3"
                      containerClassName="select-dropdown-underline"
                      style={{ minWidth: 200 }}
                      onChange={(v) => {
                        const newValue = new Set(selected);
                        const tag = v;
                        filteredOptions.forEach((m) => {
                          if (m.tags && m.tags.includes(tag)) {
                            newValue.add(m.id);
                          }
                        });
                        onChange(Array.from(newValue));
                      }}
                      options={[
                        {
                          value: "...",
                          label: "...",
                        },
                        ...Object.keys(tagCounts).map((k) => ({
                          value: k,
                          label: `${k} (${tagCounts[k]})`,
                        })),
                      ]}
                    />
                  </div>
                )}
            </div>
          </div>
        </>
      }
    />
  ) : (
    <SelectField
      key={datasource ?? "__no_datasource__"} // forces selector UI to clear when changing datasource
      value={selected[0]}
      onChange={(m) => onChange([m])}
      options={filteredOptions.map((m) => {
        return {
          value: m.id,
          label: m.name,
          tooltip: m.description,
        };
      })}
      placeholder="Select metric..."
      autoFocus={autoFocus}
      isOptionDisabled={isOptionDisabled}
      formatOptionLabel={({ value, label }, { context }) => {
        return value ? (
          <MetricName
            id={value}
            showDescription={context !== "value"}
            badgeColor={
              context !== "value" ? "var(--blue-11)" : "var(--violet-11)"
            }
          />
        ) : (
          label
        );
      }}
      disabled={disabled}
      helpText={helpText}
    />
  );

  return (
    <div className="position-relative">
      {!forceSingleMetric && selected.length > 0 && (
        <div className="position-absolute" style={{ right: 0, top: -25 }}>
          <Tooltip body="Copy metrics" tipPosition="top" tipMinWidth="90">
            <ClickToCopy compact valueToCopy={JSON.stringify(selected)} />
          </Tooltip>
        </div>
      )}
      {selector}
    </div>
  );
};

export default MetricsSelector;

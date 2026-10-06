import { FC, ReactNode, useCallback, useMemo, useState } from "react";
import {
  resolveAnalysisIdentifierType,
  isProjectListValidForProject,
} from "shared/util";
import {
  ExperimentMetricDefinition,
  getFactMetricFactTableIds,
  isFactMetric,
  isFactMetricJoinable,
  isMetricGroupId,
  isMetricJoinable,
  quantileMetricType,
} from "shared/experiments";
import { Flex, IconButton } from "@radix-ui/themes";
import { FactMetricType } from "shared/types/fact-table";
import { PiInfo, PiTag } from "react-icons/pi";
import Text from "@/ui/Text";
import { useDefinitions } from "@/services/DefinitionsContext";
import MultiSelectField from "@/ui/MultiSelectField";
import SelectField, {
  GroupedValue,
  SingleValue,
} from "@/components/Forms/SelectField";
import Tooltip from "@/components/Tooltip/Tooltip";
import MetricName from "@/components/Metrics/MetricName";
import { useUser } from "@/services/UserContext";
import MetricGroupInlineForm from "@/enterprise/components/MetricGroupInlineForm";
import Link from "@/ui/Link";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/ui/DropdownMenu";
import UITooltip from "@/ui/Tooltip";
import styles from "./MetricsSelector.module.scss";

type MetricOption = {
  id: string;
  name: string;
  description: string;
  datasource: string;
  tags: string[];
  projects: string[];
  factTables: string[];
  joinable: boolean;
  isGroup: boolean;
  metrics?: string[];
  managedBy?: string;
  disabled?: boolean;
  disabledReason?: string;
};

type MetricsSelectorTooltipProps = {
  onlyBinomial?: boolean;
  noQuantileGoalMetrics?: boolean;
  noFactFunnelMetrics?: boolean;
  isSingular?: boolean;
};

export const MetricsSelectorTooltip = ({
  onlyBinomial = false,
  noQuantileGoalMetrics = false,
  noFactFunnelMetrics = false,
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
              <li>
                {isSingular ? "is" : "are"} a proportion (or binomial) metric
              </li>
            ) : null}
            {noQuantileGoalMetrics ? (
              <li>
                {isSingular
                  ? "is not a quantile metric"
                  : "are not quantile metrics"}
              </li>
            ) : null}
            {noFactFunnelMetrics ? (
              <li>
                {isSingular
                  ? "is not a funnel metric"
                  : "are not funnel metrics"}
              </li>
            ) : null}
          </ul>
        </>
      }
    />
  );
};

// @/ui/Select's chevron: Radix Themes' ChevronDownIcon, which it doesn't
// export, redrawn from the same path.
const SelectChevron = () => (
  <svg
    width="9"
    height="9"
    viewBox="0 0 9 9"
    fill="currentColor"
    aria-hidden
    style={{ display: "block" }}
  >
    <path d="M0.135232 3.15803C0.324102 2.95657 0.640521 2.94637 0.841971 3.13523L4.5 6.56464L8.158 3.13523C8.3595 2.94637 8.6759 2.95657 8.8648 3.15803C9.0536 3.35949 9.0434 3.67591 8.842 3.86477L4.84197 7.6148C4.64964 7.7951 4.35036 7.7951 4.15803 7.6148L0.158031 3.86477C-0.0434285 3.67591 -0.0536285 3.35949 0.135232 3.15803Z" />
  </svg>
);

const MetricsSelector: FC<{
  datasource?: string;
  project?: string;
  exposureQueryId?: string;
  exposureQueryIdentifierType?: string;
  selected: string[];
  onChange: (metrics: string[]) => void;
  autoFocus?: boolean;
  includeFacts?: boolean;
  includeGroups?: boolean;
  excludeQuantiles?: boolean;
  allowedFactMetricTypes?: FactMetricType[];
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
  requireDatasource?: boolean;
  // "menu": select-by-tag as a tag button inside the field, on the right,
  // that opens a menu of tags, instead of the "Select metric by tag" row
  // under it. Optional and additive: "row" (the default) is as before. Used
  // by the redesigned experiment Setup page.
  tagSelect?: "row" | "menu";
  // Wraps a selected metric's chip label, e.g. to open details on click.
  // Optional and additive; used by the redesigned experiment Setup page.
  renderSelectedLabel?: (id: string, label: ReactNode) => ReactNode;
}> = ({
  datasource,
  project,
  exposureQueryId,
  exposureQueryIdentifierType,
  selected,
  onChange,
  autoFocus,
  includeFacts,
  includeGroups = true,
  excludeQuantiles,
  allowedFactMetricTypes,
  forceSingleMetric = false,
  noManual = false,
  noLegacyMetrics = false,
  filterConversionWindowMetrics,
  disabled,
  helpText,
  groupOptions = true,
  getMetricDisabledInfo,
  requireDatasource = false,
  tagSelect = "row",
  renderSelectedLabel,
}) => {
  const [createMetricGroup, setCreateMetricGroup] = useState(false);
  const {
    metrics,
    metricGroups,
    factMetrics,
    getExperimentMetricById,
    getFactTableById,
    getDatasourceById,
    mutateDefinitions,
  } = useDefinitions();
  const { hasCommercialFeature } = useUser();

  const metricListContainsGroup = selected.some((metric) =>
    isMetricGroupId(metric),
  );

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

  const filteredOptions = useMemo(() => {
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
            joinable:
              !datasourceSettings ||
              !userIdType ||
              !(m.userIdTypes || []).length
                ? true
                : isMetricJoinable(
                    m.userIdTypes || [],
                    userIdType,
                    datasourceSettings,
                  ),
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
              if (
                allowedFactMetricTypes &&
                !allowedFactMetricTypes.includes(m.metricType)
              ) {
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
                factTables: getFactMetricFactTableIds(m),
                joinable:
                  !datasourceSettings || !userIdType
                    ? true
                    : isFactMetricJoinable(
                        m,
                        userIdType,
                        getFactTableById,
                        datasourceSettings,
                      ),
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
                joinable: true,
                isGroup: true,
                metrics: mg.metrics,
                disabled: disabledInfo.disabled,
                disabledReason: disabledInfo.reason,
              };
            })
        : []),
    ];

    return options
      .filter((m) =>
        datasource ? m.datasource === datasource : !requireDatasource,
      )
      .filter((m) => m.joinable)
      .filter((m) => isProjectListValidForProject(m.projects, project));
  }, [
    metrics,
    factMetrics,
    getFactTableById,
    metricGroups,
    datasource,
    datasourceSettings,
    userIdType,
    project,
    noLegacyMetrics,
    noManual,
    includeFacts,
    includeGroups,
    excludeQuantiles,
    allowedFactMetricTypes,
    filterConversionWindowMetrics,
    getMetricDisabledInfo,
    requireDatasource,
  ]);

  // O(1) lookup map for filteredOptions by id
  const filteredOptionsMap = useMemo(() => {
    const map = new Map<string, MetricOption>();
    for (const opt of filteredOptions) {
      map.set(opt.id, opt);
    }
    return map;
  }, [filteredOptions]);

  const isOptionDisabled = useCallback(
    (option: SingleValue | GroupedValue): boolean => {
      if ("options" in option) {
        return false;
      }
      return filteredOptionsMap.get(option.value)?.disabled ?? false;
    },
    [filteredOptionsMap],
  );

  const tagCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    const selectedSet = new Set(selected);
    filteredOptions.forEach((m) => {
      if (!selectedSet.has(m.id) && m.tags) {
        m.tags.forEach((t) => {
          counts[t] = (counts[t] || 0) + 1;
        });
      }
    });
    return counts;
  }, [filteredOptions, selected]);

  let showMetricGroupHelper =
    hasCommercialFeature("metric-groups") &&
    selected.length >= 2 &&
    !metricListContainsGroup &&
    datasource;

  // Disable this for now since it is making the UI too cluttered
  // We will revisit when we re-design the metric selector
  showMetricGroupHelper = false;

  // Pre-compute joinable status for all metric groups once, not per-render of each option
  const groupMetricsJoinableMap = useMemo(() => {
    const map = new Map<
      string,
      { metric: ExperimentMetricDefinition | null; joinable: boolean }[]
    >();
    for (const opt of filteredOptions) {
      if (!opt.isGroup || !opt.metrics) continue;
      map.set(
        opt.id,
        opt.metrics.map((m) => {
          const metric = getExperimentMetricById(m);
          if (!metric) return { metric, joinable: false };
          if (isFactMetric(metric)) {
            return {
              metric,
              joinable: userIdType
                ? isFactMetricJoinable(
                    metric,
                    userIdType,
                    getFactTableById,
                    datasourceSettings,
                  )
                : true,
            };
          }
          const userIdTypes = metric.userIdTypes || [];
          return {
            metric,
            joinable:
              userIdType && userIdTypes.length
                ? isMetricJoinable(userIdTypes, userIdType, datasourceSettings)
                : true,
          };
        }),
      );
    }
    return map;
  }, [
    filteredOptions,
    getExperimentMetricById,
    getFactTableById,
    userIdType,
    datasourceSettings,
  ]);

  const multiSelectOptions = useMemo(() => {
    if (groupOptions) {
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

      // If there is only one group, return the options as SingleValue[] instead of GroupedValue[]
      if (groupedOptions.length === 1) {
        return groupedOptions[0].options;
      }

      return groupedOptions;
    }

    return filteredOptions.map((m) => {
      const tooltipText =
        m.disabled && m.disabledReason
          ? `${m.description || ""}\n\n${m.disabledReason}`.trim()
          : m.description;

      return {
        value: m.id,
        label: m.name,
        tooltip: tooltipText,
      };
    });
  }, [filteredOptions, groupOptions]);

  const multiFormatOptionLabel = useCallback(
    ({ value, label }: SingleValue, { context }: { context: string }) => {
      if (!value) return label;
      const option = filteredOptionsMap.get(value);
      const isGroup = option?.isGroup;
      const metricsWithJoinableStatus = isGroup
        ? groupMetricsJoinableMap.get(value) || []
        : [];
      const name = (
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
      );
      return context === "value" && renderSelectedLabel
        ? renderSelectedLabel(value, name)
        : name;
    },
    [
      renderSelectedLabel,
      filteredOptionsMap,
      groupMetricsJoinableMap,
      filterConversionWindowMetrics,
    ],
  );

  const singleSelectOptions = useMemo(
    () =>
      filteredOptions.map((m) => ({
        value: m.id,
        label: m.name,
        tooltip: m.description,
      })),
    [filteredOptions],
  );

  const singleFormatOptionLabel = useCallback(
    ({ value, label }: SingleValue, { context }: { context: string }) => {
      if (!value) return label;
      return (
        <MetricName
          id={value}
          showDescription={context !== "value"}
          badgeColor={
            context !== "value" ? "var(--blue-11)" : "var(--violet-11)"
          }
        />
      );
    },
    [],
  );

  const selectorDisabled = disabled || (requireDatasource && !datasource);

  // Adds every metric with the tag, as the "Select metric by tag" row does.
  const addMetricsWithTag = (tag: string) => {
    const newValue = new Set(selected);
    filteredOptions.forEach((m) => {
      if (m.tags && m.tags.includes(tag)) {
        newValue.add(m.id);
      }
    });
    onChange(Array.from(newValue));
  };
  const showTagSelect =
    !forceSingleMetric && filteredOptions.length > 0 && !disabled;
  const tagMenu =
    tagSelect === "menu" &&
    showTagSelect &&
    Object.keys(tagCounts).length > 0 ? (
      // FALLBACK: Radix IconButton for the trigger; @/ui/ has no icon button.
      <DropdownMenu
        trigger={
          <IconButton
            // Shown only while the field is hovered (see
            // MetricsSelector.module.scss).
            className={styles.tagButton}
            variant="ghost"
            color="gray"
            radius="full"
            size="1"
            aria-label="Select metrics by tag"
          >
            <UITooltip content="Select metrics by tag">
              <span style={{ display: "inline-flex" }}>
                <PiTag size="14" />
              </span>
            </UITooltip>
          </IconButton>
        }
        menuPlacement="end"
      >
        <DropdownMenuLabel textSize="sm">
          Add all metrics with a tag
        </DropdownMenuLabel>
        {Object.keys(tagCounts).map((k) => (
          <DropdownMenuItem key={k} onClick={() => addMetricsWithTag(k)}>
            {k} ({tagCounts[k]})
          </DropdownMenuItem>
        ))}
      </DropdownMenu>
    ) : null;

  const selector = !forceSingleMetric ? (
    <MultiSelectField
      legacyHeight
      value={selected}
      onChange={onChange}
      options={multiSelectOptions}
      placeholder="Select metrics..."
      autoFocus={autoFocus}
      isOptionDisabled={isOptionDisabled}
      formatOptionLabel={multiFormatOptionLabel}
      disabled={selectorDisabled}
      indicatorsStart={tagMenu}
      customClassName={tagSelect === "menu" ? styles.typeaheadField : undefined}
      // The Setup page's fields use @/ui/Select's chevron (Radix's 9px
      // ChevronDownIcon), to match the selects around them (set in review).
      dropdownIcon={tagSelect === "menu" ? <SelectChevron /> : undefined}
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
                  <Flex
                    align="center"
                    gap="1"
                    style={{ color: "var(--violet-11)" }}
                  >
                    <PiInfo color="var(--color-text-low)" className="mr-1" />
                    <Text size="sm">
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
                  </Flex>
                </>
              )}
            </Flex>
          ) : null}
          <div className="d-flex align-items-center justify-content-end">
            <div>
              {tagSelect === "row" && showTagSelect && (
                <div className="metric-from-tag text-muted form-inline">
                  <span
                    style={{
                      color: "var(--color-text-low)",
                      fontWeight: 500,
                    }}
                  >
                    Select metric by tag
                    <Tooltip body="Metrics can be tagged for grouping. Select any tag to add all metrics associated with that tag.">
                      <PiInfo color="var(--color-text-low)" className="ml-1" />
                    </Tooltip>
                  </span>
                  <SelectField
                    size="legacy"
                    value="choose"
                    placeholder="choose"
                    className="ml-3"
                    containerClassName="select-dropdown-underline"
                    style={{ minWidth: 140 }}
                    onChange={addMetricsWithTag}
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
      size="legacy"
      key={datasource ?? "__no_datasource__"} // forces selector UI to clear when changing datasource
      value={selected[0]}
      onChange={(m) => onChange([m])}
      options={singleSelectOptions}
      placeholder="Select metric..."
      autoFocus={autoFocus}
      isOptionDisabled={isOptionDisabled}
      formatOptionLabel={singleFormatOptionLabel}
      disabled={selectorDisabled}
      helpText={helpText}
    />
  );

  return selector;
};

export default MetricsSelector;

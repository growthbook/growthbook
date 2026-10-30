import { FC, ReactNode, useCallback, useMemo, useState } from "react";
import {
  resolveAnalysisIdentifierType,
  isProjectListValidForProject,
} from "shared/util";
import { DecisionFrameworkMetricOverrides } from "shared/types/experiment";
import {
  ExperimentMetricDefinition,
  getFactMetricFactTableIds,
  isFactMetric,
  isFactMetricJoinable,
  isMetricGroupId,
  isMetricJoinable,
  quantileMetricType,
} from "shared/experiments";
import { Box, Flex } from "@radix-ui/themes";
import {
  FactMetricInterface,
  FactMetricType,
  FactTableDefinition,
} from "shared/types/fact-table";
import { PiInfo, PiTag } from "react-icons/pi";
import { MetricOverride } from "shared/validators";
import Text from "@/ui/Text";
import { useDefinitions } from "@/services/DefinitionsContext";
import MultiSelectField from "@/ui/MultiSelectField";
import SelectField, {
  ReactSelectProps,
  GroupedValue,
  SingleValue,
} from "@/components/Forms/SelectField";
import { OptionPopover } from "@/components/Features/OptionTooltipShell";
import {
  MetricOverrideTooltipContent,
  MetricSettingsScope,
} from "@/components/Experiment/MetricOverrideTooltip";
import {
  getOverriddenMetricIds,
  METRIC_OVERRIDE_BORDER_COLOR,
} from "@/services/metricOverrides";
import Tooltip from "@/components/Tooltip/Tooltip";
import UITooltip from "@/ui/Tooltip";
import MetricName from "@/components/Metrics/MetricName";
import { useUser } from "@/services/UserContext";
import MetricGroupInlineForm from "@/enterprise/components/MetricGroupInlineForm";
import Link from "@/ui/Link";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/ui/DropdownMenu";

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
  archivedReason?: string;
};

function MetricTagPicker({
  tagCounts,
  onSelect,
}: {
  tagCounts: Record<string, number>;
  onSelect: (tag: string) => void;
}) {
  return (
    <DropdownMenu
      menuPlacement="end"
      variant="soft"
      trigger={
        <button
          type="button"
          className="gb-multi-select__tag-button"
          aria-label="Add metrics by tag"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <UITooltip content={<Text align="left">Add metrics by tag</Text>}>
            <span style={{ display: "flex" }}>
              <PiTag />
            </span>
          </UITooltip>
        </button>
      }
    >
      <DropdownMenuLabel>Add metrics by tag</DropdownMenuLabel>
      {Object.keys(tagCounts)
        .sort((a, b) => a.localeCompare(b))
        .map((tag) => (
          <DropdownMenuItem key={tag} onClick={() => onSelect(tag)}>
            <Flex align="center" gap="2" justify="between" width="100%">
              <span>{tag}</span>
              <Text color="text-low">{tagCounts[tag]}</Text>
            </Flex>
          </DropdownMenuItem>
        ))}
    </DropdownMenu>
  );
}

export const ARCHIVED_METRIC_REASON = "This metric is archived.";

export function getArchivedFactMetricReason(
  metric: FactMetricInterface,
  getFactTableById: (id: string) => FactTableDefinition | null,
): string {
  const archivedFactTable = metric.archived
    ? null
    : getFactMetricFactTableIds(metric)
        .map((id) => getFactTableById(id))
        .find((ft) => ft?.archived);
  return archivedFactTable
    ? `The fact table "${archivedFactTable.name}" is archived.`
    : ARCHIVED_METRIC_REASON;
}

// The name truncates before the suffix so "(archived)" is never clipped.
// `tooltip` is for single selects, which don't render option tooltips.
export function ArchivedLabel({
  archived,
  alignRight,
  tooltip,
  children,
}: {
  archived?: boolean;
  alignRight?: boolean;
  tooltip?: ReactNode;
  children: ReactNode;
}) {
  if (!archived) return <>{children}</>;
  const label = (
    <Flex
      align="center"
      gap="2"
      justify={alignRight ? "between" : "start"}
      width={alignRight ? "100%" : undefined}
      minWidth="0"
    >
      <Box
        minWidth="0"
        overflow="hidden"
        style={{ textOverflow: "ellipsis", whiteSpace: "nowrap" }}
      >
        {children}
      </Box>
      <Box flexShrink="0">
        <Text size="sm" color="text-low">
          (archived)
        </Text>
      </Box>
    </Flex>
  );
  return tooltip ? (
    <UITooltip content={tooltip} side="right">
      {label}
    </UITooltip>
  ) : (
    label
  );
}

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
  /** Gives each chosen metric a hover card and outlines overridden ones. */
  metricOverrides?: MetricOverride[];
  /** Opens an override editor on the metrics a card was opened for. */
  onManageOverrides?: (metricIds: string[]) => void;
  /** Lets a chosen metric's card list the settings it's analysed with. */
  settingsScope?: MetricSettingsScope;
  /** Goal metrics' target MDEs, which count as overrides here. */
  targetMDEOverrides?: DecisionFrameworkMetricOverrides[];
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
  metricOverrides,
  onManageOverrides,
  settingsScope,
  targetMDEOverrides,
}) => {
  const [createMetricGroup, setCreateMetricGroup] = useState(false);
  const {
    metrics,
    _metricsIncludingArchived,
    metricGroups,
    factMetrics,
    _factMetricsIncludingArchived,
    getExperimentMetricById,
    getFactTableById,
    getDatasourceById,
    getMetricGroupById,
    mutateDefinitions,
  } = useDefinitions();
  const { hasCommercialFeature } = useUser();

  const overriddenChips = useMemo(() => {
    const overridden = getOverriddenMetricIds(
      metricOverrides,
      targetMDEOverrides,
    );
    return new Set(
      selected.filter((id) =>
        (getMetricGroupById(id)?.metrics ?? [id]).some((mid) =>
          overridden.has(mid),
        ),
      ),
    );
  }, [metricOverrides, targetMDEOverrides, selected, getMetricGroupById]);

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

  // Already-selected metrics stay as options when archived (or when their fact
  // table is), otherwise editing the list would silently drop them.
  const activeIds = useMemo(
    () =>
      new Set([
        ...metrics.map((m) => m.id),
        ...factMetrics.map((m) => m.id),
        ...metricGroups.filter((mg) => !mg.archived).map((mg) => mg.id),
      ]),
    [metrics, factMetrics, metricGroups],
  );
  // Selected chips are looked up in the options, so an archived selection stays
  // an option until it's removed. Key on just those ids so other selection
  // changes don't rebuild every option.
  const archivedSelectionKey = selected
    .filter((id) => !activeIds.has(id))
    .join(",");
  const {
    metricsWithArchivedSelections,
    factMetricsWithArchivedSelections,
    archivedReasons,
  } = useMemo(() => {
    const archivedSelectedIds = new Set(
      archivedSelectionKey ? archivedSelectionKey.split(",") : [],
    );
    if (!archivedSelectedIds.size) {
      return {
        metricsWithArchivedSelections: metrics,
        factMetricsWithArchivedSelections: factMetrics,
        archivedReasons: new Map<string, string>(),
      };
    }
    const archivedSelectedMetrics = _metricsIncludingArchived.filter((m) =>
      archivedSelectedIds.has(m.id),
    );
    const archivedSelectedFactMetrics = _factMetricsIncludingArchived.filter(
      (m) => archivedSelectedIds.has(m.id),
    );
    const archivedReasons = new Map<string, string>();
    archivedSelectedMetrics.forEach((m) =>
      archivedReasons.set(m.id, ARCHIVED_METRIC_REASON),
    );
    archivedSelectedFactMetrics.forEach((m) =>
      archivedReasons.set(
        m.id,
        getArchivedFactMetricReason(m, getFactTableById),
      ),
    );
    metricGroups
      .filter((mg) => archivedSelectedIds.has(mg.id))
      .forEach((mg) =>
        archivedReasons.set(mg.id, "This metric group is archived."),
      );
    return {
      metricsWithArchivedSelections: [...metrics, ...archivedSelectedMetrics],
      factMetricsWithArchivedSelections: [
        ...factMetrics,
        ...archivedSelectedFactMetrics,
      ],
      archivedReasons,
    };
  }, [
    archivedSelectionKey,
    metrics,
    factMetrics,
    metricGroups,
    _metricsIncludingArchived,
    _factMetricsIncludingArchived,
    getFactTableById,
  ]);

  const filteredOptions = useMemo(() => {
    const options: MetricOption[] = [
      ...(noLegacyMetrics ? [] : metricsWithArchivedSelections)
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
            archivedReason: archivedReasons.get(m.id),
          };
        }),
      ...(includeFacts
        ? factMetricsWithArchivedSelections
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
                archivedReason: archivedReasons.get(m.id),
              };
            })
        : []),
      ...(includeGroups
        ? metricGroups
            .filter((mg) => !mg.archived || archivedReasons.has(mg.id))
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
                archivedReason: archivedReasons.get(mg.id),
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
    metricsWithArchivedSelections,
    factMetricsWithArchivedSelections,
    archivedReasons,
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
      if (!selectedSet.has(m.id) && !m.disabled && m.tags) {
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
        const baseTooltip =
          option.disabled && option.disabledReason
            ? option.disabledReason
            : option.description;
        // Options are deep-cloned by SelectField, so tooltips must stay strings.
        const tooltipText = option.archivedReason
          ? `${option.archivedReason} ${baseTooltip}`.trim()
          : baseTooltip;

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
      const baseTooltip =
        m.disabled && m.disabledReason
          ? `${m.description || ""}\n\n${m.disabledReason}`.trim()
          : m.description;
      const tooltipText = m.archivedReason
        ? `${m.archivedReason} ${baseTooltip}`.trim()
        : baseTooltip;

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
      // The card replaces the group tooltip rather than opening on top of it.
      const withCard = context === "value" && !!metricOverrides;
      const name = (
        <ArchivedLabel
          archived={!!option?.archivedReason}
          alignRight={context !== "value"}
        >
          <MetricName
            id={value}
            showDescription={context !== "value"}
            isGroup={isGroup}
            metrics={metricsWithJoinableStatus}
            filterConversionWindowMetrics={filterConversionWindowMetrics}
            hideGroupTooltip={withCard}
            badgeColor={
              context !== "value" ? "var(--blue-11)" : "var(--violet-11)"
            }
            officialBadgePosition="left"
          />
        </ArchivedLabel>
      );
      if (!withCard) return name;
      return (
        <OptionPopover
          context="value"
          side="bottom"
          content={
            <MetricOverrideTooltipContent
              id={value}
              overrides={metricOverrides}
              onManageOverrides={onManageOverrides}
              settingsScope={settingsScope}
              targetMDEOverrides={targetMDEOverrides}
              members={metricsWithJoinableStatus}
              filterConversionWindowMetrics={filterConversionWindowMetrics}
            />
          }
        >
          {name}
        </OptionPopover>
      );
    },
    [
      filteredOptionsMap,
      groupMetricsJoinableMap,
      filterConversionWindowMetrics,
      metricOverrides,
      onManageOverrides,
      settingsScope,
      targetMDEOverrides,
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
        <ArchivedLabel
          archived={!!filteredOptionsMap.get(value)?.archivedReason}
          alignRight
          tooltip={filteredOptionsMap.get(value)?.archivedReason}
        >
          <MetricName
            id={value}
            showDescription={context !== "value"}
            badgeColor={
              context !== "value" ? "var(--blue-11)" : "var(--violet-11)"
            }
          />
        </ArchivedLabel>
      );
    },
    [filteredOptionsMap],
  );

  const needsDatasource = requireDatasource && !datasource;
  const selectorDisabled = disabled || needsDatasource;

  const selector = !forceSingleMetric ? (
    <MultiSelectField
      legacyHeight
      value={selected}
      onChange={onChange}
      options={multiSelectOptions}
      placeholder={
        needsDatasource ? "Choose a Data Source first" : "Select metrics..."
      }
      autoFocus={autoFocus}
      isOptionDisabled={isOptionDisabled}
      formatOptionLabel={multiFormatOptionLabel}
      // The card names the chip, so a native title would only cover it.
      valueTitles={!metricOverrides}
      customStyles={
        overriddenChips.size
          ? {
              multiValue: (base, state) => ({
                ...ReactSelectProps.styles.multiValue(base),
                ...(overriddenChips.has(state.data.value)
                  ? {
                      boxShadow: `inset 0 0 0 1px ${METRIC_OVERRIDE_BORDER_COLOR}`,
                    }
                  : {}),
              }),
            }
          : undefined
      }
      disabled={selectorDisabled}
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
        </>
      }
      extraIndicator={
        !disabled && Object.keys(tagCounts).length > 0 ? (
          <MetricTagPicker
            tagCounts={tagCounts}
            onSelect={(tag) => {
              const newValue = new Set(selected);
              filteredOptions.forEach((m) => {
                if (!m.disabled && m.tags?.includes(tag)) {
                  newValue.add(m.id);
                }
              });
              onChange(Array.from(newValue));
            }}
          />
        ) : null
      }
    />
  ) : (
    <SelectField
      size="legacy"
      key={datasource ?? "__no_datasource__"} // forces selector UI to clear when changing datasource
      value={selected[0]}
      onChange={(m) => onChange([m])}
      options={singleSelectOptions}
      placeholder={
        needsDatasource ? "Choose a Data Source first" : "Select metric..."
      }
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

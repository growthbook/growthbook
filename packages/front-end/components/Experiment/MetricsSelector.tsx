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
import SelectField from "@/components/Forms/SelectField";
import Tooltip from "@/components/Tooltip/Tooltip";
import MetricName from "@/components/Metrics/MetricName";
import ClickToCopy from "@/components/Settings/ClickToCopy";
import { GBInfo } from "@/components/Icons";
import { useUser } from "@/services/UserContext";
import MetricGroupInlineForm from "@/enterprise/components/MetricGroupInlineForm";
import Link from "../Radix/Link";

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
};

type MetricsSelectorTooltipProps = {
  onlyBinomial?: boolean;
  noPercentileGoalMetrics?: boolean;
  isSingular?: boolean;
};

export const MetricsSelectorTooltip = ({
  onlyBinomial = false,
  noPercentileGoalMetrics = false,
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
            {noPercentileGoalMetrics ? (
              <li>{isSingular ? "does" : "do"} not use percentile capping</li>
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
  noPercentile?: boolean;
  noManual?: boolean;
  disabled?: boolean;
  helpText?: ReactNode;
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
  noPercentile = false,
  noManual = false,
  disabled,
  helpText,
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
    isMetricGroupId(metric)
  );

  const options: MetricOption[] = [
    ...metrics
      .filter((m) =>
        noPercentile ? m.cappingSettings.type !== "percentile" : true
      )
      .filter((m) => (noManual ? m.datasource : true))
      .map((m) => ({
        id: m.id,
        name: m.name,
        description: m.description || "",
        datasource: m.datasource || "",
        tags: m.tags || [],
        projects: m.projects || [],
        factTables: [],
        userIdTypes: m.userIdTypes || [],
        isGroup: false,
      })),
    ...(includeFacts
      ? factMetrics
          .filter((m) => {
            if (quantileMetricType(m) && excludeQuantiles) {
              return false;
            }
            if (noPercentile) {
              return m.cappingSettings.type !== "percentile";
            }
            return true;
          })
          .map((m) => ({
            id: m.id,
            name: m.name,
            description: m.description || "",
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
            isGroup: false,
          }))
      : []),
    ...(includeGroups
      ? metricGroups
          .filter((mg) => !mg.archived)
          .map((mg) => ({
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
          }))
      : []),
  ];

  // get data to help filter metrics to those with joinable userIdTypes to
  // the experiment assignment table
  const datasourceSettings = datasource
    ? getDatasourceById(datasource)?.settings
    : undefined;
  // todo: get specific exposure query from experiment?
  const userIdType = datasourceSettings?.queries?.exposure?.find(
    (e) => e.id === exposureQueryId
  )?.userIdType;

  const filteredOptions = options
    .filter((m) => (datasource ? m.datasource === datasource : true))
    .filter((m) =>
      datasourceSettings && userIdType && m.userIdTypes.length
        ? isMetricJoinable(m.userIdTypes, userIdType, datasourceSettings)
        : true
    )
    .filter((m) => isProjectListValidForProject(m.projects, project));

  const tagCounts: Record<string, number> = {};
  filteredOptions.forEach((m) => {
    if (!selected.includes(m.id) && m.tags) {
      m.tags.forEach((t) => {
        tagCounts[t] = tagCounts[t] || 0;
        tagCounts[t]++;
      });
    }
  });

  const showMetricGroupHelper =
    hasCommercialFeature("metric-groups") &&
    selected.length >= 2 &&
    !metricListContainsGroup &&
    datasource;

  const selector = !forceSingleMetric ? (
    <MultiSelectField
      value={selected}
      onChange={onChange}
      options={filteredOptions.map((m) => {
        return {
          value: m.id,
          label: m.name,
          tooltip: m.description,
        };
      })}
      placeholder="Select metrics..."
      autoFocus={autoFocus}
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
                        datasourceSettings
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
                d.startsWith("fact__")
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
          {showMetricGroupHelper ? (
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
              {!forceSingleMetric && filteredOptions.length > 0 && !disabled && (
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
      formatOptionLabel={({ value, label }, { context }) => {
        return value ? (
          <MetricName id={value} showDescription={context !== "value"} />
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

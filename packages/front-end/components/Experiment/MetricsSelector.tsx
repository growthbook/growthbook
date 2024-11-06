import { FC } from "react";
import { FaQuestionCircle } from "react-icons/fa";
import { isProjectListValidForProject } from "shared/util";
import {
  isFactMetric,
  isMetricJoinable,
  quantileMetricType,
} from "shared/experiments";
import { useDefinitions } from "@/services/DefinitionsContext";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import SelectField from "@/components/Forms/SelectField";
import Tooltip from "@/components/Tooltip/Tooltip";
import MetricName from "@/components/Metrics/MetricName";
import ClickToCopy from "@/components/Settings/ClickToCopy";

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
  disabled?: boolean;
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
  disabled,
}) => {
  const {
    metrics,
    metricGroups,
    factMetrics,
    factTables,
    getExperimentMetricById,
    getDatasourceById,
  } = useDefinitions();

  const options: MetricOption[] = [
    ...metrics
      .filter((m) =>
        noPercentile ? m.cappingSettings.type !== "percentile" : true
      )
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
      <div className="d-flex align-items-center justify-content-end">
        <div>
          {!forceSingleMetric && filteredOptions.length > 0 && !disabled && (
            <div className="metric-from-tag text-muted form-inline mt-2">
              <span style={{ fontSize: "0.82rem" }}>
                Select metric by tag:{" "}
                <Tooltip body="Metrics can be tagged for grouping. Select any tag to add all metrics associated with that tag.">
                  <FaQuestionCircle />
                </Tooltip>
              </span>
              <SelectField
                value="choose"
                placeholder="choose"
                className="ml-3"
                style={{ minWidth: 100 }}
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
    </div>
  );
};

export default MetricsSelector;

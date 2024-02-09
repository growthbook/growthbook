import { FC } from "react";
import { FaQuestionCircle } from "react-icons/fa";
import { isProjectListValidForProject } from "shared/util";
import { DataSourceSettings } from "back-end/types/datasource";
import { useDefinitions } from "@/services/DefinitionsContext";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import SelectField from "@/components/Forms/SelectField";
import Tooltip from "@/components/Tooltip/Tooltip";
import MetricName from "../Metrics/MetricName";

type MetricOption = {
  id: string;
  name: string;
  datasource: string;
  tags: string[];
  projects: string[];
  factTables: string[];
  userIdTypes: string[];
};

type MetricsSelectorTooltipProps = {
  onlyBinomial?: boolean;
};

export const MetricsSelectorTooltip = ({
  onlyBinomial = false,
}: MetricsSelectorTooltipProps) => {
  return (
    <Tooltip
      body={
        <>
          You can only select metrics that fit all criteria below:
          <ul>
            <li>are from the same Data Source as the experiment</li>
            <li>
              either share an Identifier Type with the Experiment Assignment
              Table or can be joined to it by a Join Table
            </li>
            {onlyBinomial ? <li>are a binomial metric</li> : null}
          </ul>
        </>
      }
    />
  );
};

export function isMetricJoinable(
  metricIdTypes: string[],
  userIdType: string,
  settings: DataSourceSettings
): boolean {
  if (metricIdTypes.includes(userIdType)) return true;

  if (settings?.queries?.identityJoins) {
    if (
      settings.queries.identityJoins.some(
        (j) =>
          j.ids.includes(userIdType) &&
          j.ids.some((jid) => metricIdTypes.includes(jid))
      )
    ) {
      return true;
    }
  }

  // legacy support for pageviewsQuery
  if (settings?.queries?.pageviewsQuery) {
    if (
      ["user_id", "anonymous_id"].includes(userIdType) &&
      metricIdTypes.some((m) => ["user_id", "anonymous_id"].includes(m))
    ) {
      return true;
    }
  }

  return false;
}

const MetricsSelector: FC<{
  datasource?: string;
  project?: string;
  exposureQueryId?: string;
  selected: string[];
  onChange: (metrics: string[]) => void;
  autoFocus?: boolean;
  includeFacts?: boolean;
}> = ({
  datasource,
  project,
  exposureQueryId,
  selected,
  onChange,
  autoFocus,
  includeFacts,
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
        }))
      : []),
  ];

  // get data to help filter metrics to those with joinable userIdTypes to
  // the experiment assignment table
  const datasourceSettings = datasource
    ? getDatasourceById(datasource)?.settings
    : undefined;
  const userIdType = datasourceSettings?.queries?.exposure?.find(
    (e) => e.id === exposureQueryId
  )?.userIdType;

  const filteredOptions = options
    .filter((m) => (datasource ? m.datasource === datasource : true))
    .filter((m) =>
      userIdType && m.userIdTypes.length
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

  return (
    <>
      <MultiSelectField
        value={selected}
        onChange={onChange}
        options={filteredOptions.map((m) => {
          return {
            value: m.id,
            label: m.name,
          };
        })}
        placeholder="Select metrics..."
        autoFocus={autoFocus}
        formatOptionLabel={({ value, label }) => {
          return value ? <MetricName id={value} /> : label;
        }}
      />
      {Object.keys(tagCounts).length > 0 && (
        <div className="metric-from-tag text-muted form-inline mt-2">
          <span style={{ fontSize: "0.82rem" }}>
            Select metric by tag:{" "}
            <Tooltip body="Metrics can be tagged for grouping. Select any tag to add all metrics associated with that tag.">
              <FaQuestionCircle />
            </Tooltip>
          </span>
          <SelectField
            placeholder="..."
            value="..."
            className="ml-3"
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
    </>
  );
};

export default MetricsSelector;

import { FC } from "react";
import { FaQuestionCircle } from "react-icons/fa";
import { isProjectListValidForProject } from "shared/util";
import { useDefinitions } from "@/services/DefinitionsContext";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import SelectField from "@/components/Forms/SelectField";
import Tooltip from "@/components/Tooltip/Tooltip";
import FactBadge from "../FactTables/FactBadge";
import OfficialBadge from "../Metrics/OfficialBadge";

type MetricOption = {
  id: string;
  name: string;
  datasource: string;
  tags: string[];
  projects: string[];
  factTables: string[];
};

const MetricsSelector: FC<{
  datasource?: string;
  project?: string;
  selected: string[];
  onChange: (metrics: string[]) => void;
  autoFocus?: boolean;
  includeFacts?: boolean;
}> = ({ datasource, project, selected, onChange, autoFocus, includeFacts }) => {
  const { metrics, factMetrics, getExperimentMetricById } = useDefinitions();

  const options: MetricOption[] = [
    ...metrics.map((m) => ({
      id: m.id,
      name: m.name,
      datasource: m.datasource || "",
      tags: m.tags || [],
      projects: m.projects || [],
      factTables: [],
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
        }))
      : []),
  ];

  const filteredOptions = options
    .filter((m) => (datasource ? m.datasource === datasource : true))
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
        formatOptionLabel={({ label, value }) => {
          const m = getExperimentMetricById(value);
          return (
            <>
              {label}
              <FactBadge metricId={value} />
              {m?.official ? <OfficialBadge type="Metric" /> : null}
            </>
          );
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

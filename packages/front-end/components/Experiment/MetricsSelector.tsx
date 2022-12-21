import { FC } from "react";
import { FaQuestionCircle } from "react-icons/fa";
import { useDefinitions } from "@/services/DefinitionsContext";
import MultiSelectField from "@/components/Forms/MultiSelectField";
import SelectField from "@/components/Forms/SelectField";
import Tooltip from "@/components/Tooltip/Tooltip";

const MetricsSelector: FC<{
  datasource?: string;
  project?: string;
  selected: string[];
  onChange: (metrics: string[]) => void;
  autoFocus?: boolean;
}> = ({ datasource, project, selected, onChange, autoFocus }) => {
  const { metrics } = useDefinitions();
  const filteredMetrics = metrics
    .filter((m) => m.datasource === datasource)
    .filter((m) => {
      if (!project) return true;
      if (!m?.projects?.length) return true;
      return m.projects.includes(project);
    });

  const tagCounts: Record<string, number> = {};
  filteredMetrics.forEach((m) => {
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
        options={filteredMetrics.map((m) => {
          return {
            value: m.id,
            label: m.name,
          };
        })}
        placeholder="Select metrics..."
        autoFocus={autoFocus}
      />
      {Object.keys(tagCounts).length > 0 && (
        <div className="metric-from-tag text-muted form-inline mt-2">
          <span style={{ fontSize: "0.82rem" }}>
            Select metric by tag:{" "}
            <Tooltip body="Metrics can be tagged for grouping. Select any tag to add those metrics">
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
              filteredMetrics.forEach((m) => {
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

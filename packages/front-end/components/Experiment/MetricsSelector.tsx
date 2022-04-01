import { FC } from "react";
import { useDefinitions } from "../../services/DefinitionsContext";
import { FaQuestionCircle } from "react-icons/fa";
import Tooltip from "../Tooltip";
import MultiSelectField from "../Forms/MultiSelectField";

const MetricsSelector: FC<{
  datasource?: string;
  selected: string[];
  onChange: (metrics: string[]) => void;
  autoFocus?: boolean;
}> = ({ datasource, selected, onChange, autoFocus }) => {
  const { metrics } = useDefinitions();

  const validMetrics = metrics.filter(
    (m) => !datasource || m.datasource === datasource
  );

  const tagCounts: Record<string, number> = {};
  validMetrics.forEach((m) => {
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
        options={validMetrics.map((m) => {
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
            <Tooltip text="Metrics can be tagged for grouping. Select any tag to add those metrics">
              <FaQuestionCircle />
            </Tooltip>
          </span>
          <select
            placeholder="..."
            value="..."
            className="form-control ml-3"
            onChange={(e) => {
              const newValue = new Set(selected);
              const tag = e.target.value;
              validMetrics.forEach((m) => {
                if (m.tags && m.tags.includes(tag)) {
                  newValue.add(m.id);
                }
              });
              onChange(Array.from(newValue));
            }}
          >
            <option value="...">...</option>
            {Object.keys(tagCounts).map((k) => (
              <option value={k} key={k}>
                {k} ({tagCounts[k]})
              </option>
            ))}
          </select>
        </div>
      )}
    </>
  );
};

export default MetricsSelector;

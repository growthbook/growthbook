import { FC } from "react";
import { Typeahead } from "react-bootstrap-typeahead";
import { useDefinitions } from "../../services/DefinitionsContext";

const MetricsSelector: FC<{
  datasource?: string;
  selected: string[];
  onChange: (metrics: string[]) => void;
}> = ({ datasource, selected, onChange }) => {
  const { metrics, getMetricById } = useDefinitions();

  const validMetrics = metrics.filter(
    (m) => !datasource || m.datasource === datasource
  );

  const toMetricValue = (id: string) => {
    return {
      id,
      name: getMetricById(id)?.name,
    };
  };

  return (
    <Typeahead
      id="experiment-metrics"
      labelKey="name"
      multiple={true}
      options={validMetrics.map((m) => {
        return {
          id: m.id,
          name: m.name,
        };
      })}
      onChange={(selected: { id: string; name: string }[]) => {
        onChange(selected.map((s) => s.id));
      }}
      selected={selected.map(toMetricValue)}
      placeholder="Select metrics..."
    />
  );
};

export default MetricsSelector;

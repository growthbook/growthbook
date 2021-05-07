import { FC } from "react";
import { Typeahead } from "react-bootstrap-typeahead";
import { useMetrics } from "../../services/MetricsContext";

const MetricsSelector: FC<{
  datasource?: string;
  selected: string[];
  onChange: (metrics: string[]) => void;
}> = ({ datasource, selected, onChange }) => {
  const { metrics, getDisplayName } = useMetrics();

  const validMetrics = metrics.filter(
    (m) => !datasource || m.datasource === datasource
  );

  const toMetricValue = (id: string) => {
    return {
      id,
      name: getDisplayName(id),
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

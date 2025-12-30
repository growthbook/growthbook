import { DataVizConfig, LineChart, ScatterChart } from "shared/validators";
import { chartTypeSupportsAnchorYAxisToZero } from "shared/src/enterprise/dashboards/utils";
import Checkbox from "@/ui/Checkbox";

export default function AnchorYAxisToZeroCheckbox({
  dataVizConfig,
  onDataVizConfigChange,
}: {
  dataVizConfig: Partial<DataVizConfig>;
  onDataVizConfigChange: (dataVizConfig: Partial<DataVizConfig>) => void;
}) {
  if (
    dataVizConfig.chartType &&
    !chartTypeSupportsAnchorYAxisToZero(dataVizConfig.chartType)
  ) {
    return null;
  }

  // We know the chart type supports anchorYAxisToZero, so we can cast the dataVizConfig to the appropriate type.
  const configWithDisplaySettings = dataVizConfig as Partial<
    LineChart | ScatterChart
  >;
  return (
    <Checkbox
      label="Anchor y-axis to zero"
      value={
        configWithDisplaySettings.displaySettings?.anchorYAxisToZero ?? true
      }
      setValue={(anchorYAxisToZero) => {
        onDataVizConfigChange({
          ...configWithDisplaySettings,
          displaySettings: {
            ...configWithDisplaySettings.displaySettings,
            anchorYAxisToZero,
          },
        });
      }}
    />
  );
}

import { useMemo } from "react";
import { Flex } from "@radix-ui/themes";
import { DataVizConfig } from "back-end/src/validators/saved-queries";
import { Select, SelectItem } from "@/components/Radix/Select";
import { Rows } from "./SqlExplorerDataVisualization";

export default function DataVizConfigPanel({
  rows,
  config,
  onConfigChange,
}: {
  rows: Rows;
  config: DataVizConfig;
  onConfigChange: (config: DataVizConfig) => void;
}) {
  // TODO: Do we need to validate the keys?
  const rowKeys = useMemo(() => {
    return Object.keys(rows[0] || {});
  }, [rows]);

  return (
    <Flex direction="column" gap="3">
      <Select
        label="Graph Type"
        value={config.chartType}
        setValue={(v) =>
          onConfigChange({
            ...config,
            chartType: v as DataVizConfig["chartType"],
          })
        }
        size="2"
      >
        <SelectItem value="line">Line</SelectItem>
        <SelectItem value="area">Area</SelectItem>
        <SelectItem value="bar">Bar</SelectItem>
        <SelectItem value="scatter">Scatter</SelectItem>
      </Select>

      <Select
        label="X Axis"
        value={config.xAxis}
        setValue={(v) => onConfigChange({ ...config, xAxis: v })}
        size="2"
      >
        {rowKeys.map((key) => (
          <SelectItem key={key} value={key}>
            {key}
          </SelectItem>
        ))}
      </Select>

      <div className="appbox">
        <Select
          label="Y Axis"
          value={config.yAxis}
          setValue={(v) => onConfigChange({ ...config, yAxis: v })}
          size="2"
        >
          {rowKeys.map((key) => (
            <SelectItem key={key} value={key}>
              {key}
            </SelectItem>
          ))}
        </Select>
        {config.yAxis &&
          (config.chartType === "bar" ||
            config.chartType === "line" ||
            config.chartType === "area") && (
            <Select
              variant="ghost"
              size="1"
              value={config.aggregation || "grouped"}
              setValue={(v) =>
                onConfigChange({
                  ...config,
                  aggregation: v as DataVizConfig["aggregation"],
                })
              }
            >
              <SelectItem value="grouped">Grouped</SelectItem>
              <SelectItem value="stacked">Stacked</SelectItem>
            </Select>
          )}
      </div>

      <Select
        label="Group by"
        value={config.aggregationAxis || ""}
        setValue={(v) => onConfigChange({ ...config, aggregationAxis: v })}
        placeholder="Group by"
        size="2"
      >
        {rowKeys.map((key) => (
          <SelectItem key={key} value={key}>
            {key}
          </SelectItem>
        ))}
      </Select>

      {/* {config.yAxis && config.aggregation === "stacked" && (
        <Select
          variant="ghost"
          size="1"
          value={config.aggregationAxis || ""}
          placeholder="Stacked by"
          setValue={(v) =>
            onConfigChange({
              ...config,
              aggregationAxis: v,
            })
          }
        >
          {rowKeys.map((key) => (
            <SelectItem key={key} value={key}>
              {key}
            </SelectItem>
          ))}
        </Select>
      )} */}
    </Flex>
  );
}

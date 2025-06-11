import { useMemo } from "react";
import { Select, SelectItem } from "@/components/Radix/Select";
import { Rows } from "./SqlExplorerDataVisualization";

export type DataVizConfig = {
  type: "bar" | "line";
  xKey: string;
  yKey: string;
};

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
    <>
      <div className="appbox">
        <Select
          label="X Axis"
          value={config.xKey}
          setValue={(v) => onConfigChange({ ...config, xKey: v })}
          mb="3"
        >
          {rowKeys.map((key) => (
            <SelectItem key={key} value={key}>
              {key}
            </SelectItem>
          ))}
        </Select>

        <Select
          label="Y Axis"
          value={config.yKey}
          setValue={(v) => onConfigChange({ ...config, yKey: v })}
          mb="3"
        >
          {rowKeys.map((key) => (
            <SelectItem key={key} value={key}>
              {key}
            </SelectItem>
          ))}
        </Select>
      </div>
    </>
  );
}

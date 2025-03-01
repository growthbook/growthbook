import React from "react";
import ExternalLink from "./ExternalLink";
import { useGrowthBookHost } from "./HostSelector";

export interface MetricData {
  name: string;
  description?: string;
  metricType: "proportion" | "retention" | "mean" | "quantile" | "ratio";
  numerator: {
    column?: string;
    inlineFilters?: Record<string, string[]>;
    aggregation?: "sum" | "max" | "count distinct";
    aggregateFilter?: string;
    aggregateFilterColumn?: string;
  };
  denominator?: {
    column?: string;
    inlineFilters?: Record<string, string[]>;
  };
  inverse?: boolean;
  quantileSettings?: {
    quantile: number;
    type: "unit" | "event";
    ignoreZeros: boolean;
  };
  windowSettings?: {
    type: "conversion" | "lookback" | "";
    delayUnit: number;
    delayValue: "weeks" | "days" | "hours";
    windowValue: number;
    windowUnit: "weeks" | "days" | "hours";
  };
}

export default function AddMetricButton({ data }: { data: MetricData }) {
  const host = useGrowthBookHost();

  const url = `${host}/metrics?addMetric=${encodeURIComponent(
    JSON.stringify(data)
  )}`;

  // Style a to look like a button
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        WebkitUserSelect: "none",
        MozUserSelect: "none",
        userSelect: "none",
        verticalAlign: "top",
        fontStyle: "normal",
        textAlign: "center",
        borderRadius: "6px",
        backgroundColor: "#6e56cf",
        color: "#fff",
        fontSize: "16px",
        lineHeight: "24px",
        padding: "8px 16px",
        fontWeight: 500,
        WebkitAppearance: "button",
      }}
    >
      <span style={{ marginRight: "5px" }}>Add to GrowthBook</span>{" "}
      <ExternalLink />
    </a>
  );
}

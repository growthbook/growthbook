import React from "react";
import useApi from "../../hooks/useApi";
import LoadingOverlay from "../LoadingOverlay";
import {
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";

export default function ExperimentGraph({
  resolution = "month",
  num = 12,
  status = "all",
  height = 250,
}: {
  resolution?: "month" | "day" | "year";
  num?: number;
  status: "all" | "draft" | "running" | "stopped";
  height?: number;
}): React.ReactElement {
  const { data, error } = useApi<{
    data: {
      all: { name: string; numExp: number }[];
      draft: { name: string; numExp: number }[];
      running: { name: string; numExp: number }[];
      stopped: { name: string; numExp: number }[];
    };
  }>(`/experiments/frequency/${resolution}/${num}`);

  if (error) {
    return (
      <div className="alert alert-danger">
        An error occurred: {error.message}
      </div>
    );
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  const graphData = data.data[status] ? data.data[status] : data.data.all;

  if (!graphData.length) {
    return <div>no data to show</div>;
  }

  return (
    <ResponsiveContainer height={height} width="100%">
      <BarChart height={250} data={graphData} barCategoryGap="25%">
        <XAxis
          dataKey="name"
          interval={0}
          axisLine={{ stroke: "#999999", strokeWidth: 1 }}
          tick={{ fontSize: 10, fill: "#999999" }}
        />
        <YAxis
          axisLine={{ stroke: "#999999", strokeWidth: 1 }}
          tick={{ fontSize: 10, fill: "#999999" }}
        />
        <Tooltip
          cursor={{ fill: "#fff" }}
          animationEasing="ease"
          animationDuration={200}
        />
        <Bar dataKey="numExp" fill="#029dd1" />
      </BarChart>
    </ResponsiveContainer>
  );
}

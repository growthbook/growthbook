import React from "react";

type SparklineProps = {
  data: number[];
  width?: number;
  height?: number;
};

export default function Sparkline({
  data,
  width = 120,
  height = 28,
}: SparklineProps) {
  if (!data.length) return null;

  const max = Math.max(...data, 1);
  const padding = 2;
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;

  const points = data
    .map((v, i) => {
      const x = padding + (i / Math.max(data.length - 1, 1)) * innerW;
      const y = padding + innerH - (v / max) * innerH;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: "block" }}
    >
      <polyline
        points={points}
        fill="none"
        stroke="var(--accent-9)"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

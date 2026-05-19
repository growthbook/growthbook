import React from "react";

export default function MiniSparkline({
  data = [],
  color = "var(--blue-9)",
  width = 88,
  height = 28,
}: {
  data?: { t: number; v: number }[];
  color?: string;
  width?: number;
  height?: number;
}) {
  if (!data.length) {
    return (
      <span className="text-muted" style={{ fontSize: 12 }}>
        —
      </span>
    );
  }

  const values = data.map((d) => d.v);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = Math.max(max - min, 1e-6);
  const pad = 2;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;

  const yForValue = (value: number) =>
    pad + innerH - ((value - min) / span) * innerH;

  const pts = data.map((d, i) => {
    const x =
      pad + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
    return `${x},${yForValue(d.v)}`;
  });

  return (
    <svg
      width={width}
      height={height}
      style={{ display: "block", verticalAlign: "middle" }}
      aria-hidden
    >
      {data.length === 1 ? (
        <>
          <line
            x1={pad}
            x2={width - pad}
            y1={yForValue(data[0].v)}
            y2={yForValue(data[0].v)}
            style={{ stroke: color }}
            strokeWidth={1.5}
            strokeLinecap="round"
          />
          <circle
            cx={width / 2}
            cy={yForValue(data[0].v)}
            r={2}
            style={{ fill: color }}
          />
        </>
      ) : (
        <polyline
          fill="none"
          style={{ stroke: color }}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          points={pts.join(" ")}
        />
      )}
    </svg>
  );
}

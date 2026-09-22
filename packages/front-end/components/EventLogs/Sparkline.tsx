import React, { useId } from "react";
import { AreaClosed, LinePath } from "@visx/shape";
import { curveLinear } from "@visx/curve";
import { scaleLinear } from "@visx/scale";
import { LinearGradient } from "@visx/gradient";

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
  // Unique per instance so the gradient defs of adjacent rows can't collide.
  // React 18's useId returns ":R0:" — the colons make `url(#:R0:)` an invalid
  // reference and the fill silently never resolves, so strip them.
  const gradientId = `sparkline-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  if (!data.length) return null;

  const max = Math.max(...data, 1);
  // Split apart so the plot can use more of the cell vertically. 1px is the
  // floor: the 1.5px stroke centres on the path, so half of it (0.75px) sits
  // outside and would clip at the viewBox edge below that. Horizontal padding
  // stays at 2 — the round line caps at the first and last points need it.
  const paddingX = 2;
  const paddingY = 1;
  const innerW = width - paddingX * 2;
  const innerH = height - paddingY * 2;

  // Same mapping the hand-rolled polyline used, expressed as scales so the
  // line and the area share them. A single data point keeps the divisor at 1
  // rather than collapsing the domain.
  const xScale = scaleLinear<number>({
    domain: [0, Math.max(data.length - 1, 1)],
    range: [paddingX, paddingX + innerW],
  });
  const yScale = scaleLinear<number>({
    domain: [0, max],
    range: [paddingY + innerH, paddingY],
  });

  const getX = (_: number, i: number) => xScale(i);
  const getY = (v: number) => yScale(v);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      style={{ display: "block" }}
    >
      {/* Both stops are the line's own colour; only the opacity changes. Fading
          to `transparent` instead would interpolate through black in some
          engines, which shows up as a grey smear in dark mode.

          userSpaceOnUse pins the fade to the full plot height rather than to
          the area's own bounding box. With the default objectBoundingBox the
          gradient is rescaled to each row's peak, so a flat series compresses
          the whole fade into a few pixels and a peaky one stretches it —
          neighbouring rows end up with visibly different fills. */}
      <LinearGradient
        id={gradientId}
        from="var(--accent-9)"
        to="var(--accent-9)"
        fromOpacity={0.45}
        toOpacity={0.04}
        gradientUnits="userSpaceOnUse"
        x1={0}
        x2={0}
        y1={paddingY}
        y2={paddingY + innerH}
      />

      {/* Behind the line. Baseline is yScale(0), i.e. the bottom of the box. */}
      <AreaClosed
        data={data}
        x={getX}
        y={getY}
        yScale={yScale}
        curve={curveLinear}
        fill={`url(#${gradientId})`}
        stroke="none"
      />

      <LinePath
        data={data}
        x={getX}
        y={getY}
        curve={curveLinear}
        fill="none"
        stroke="var(--accent-9)"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

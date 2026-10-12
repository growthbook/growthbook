import { FC } from "react";

// Circular score indicator per the design: slate track, tier-colored arc,
// score centered. Size is the rendered square in px.
const ScoreRing: FC<{
  score: number;
  color: string; // css color for the arc + number
  size?: number;
}> = ({ score, color, size = 64 }) => {
  const radius = 24;
  const circumference = 2 * Math.PI * radius;
  const arc = (Math.min(Math.max(score, 0), 100) / 100) * circumference;

  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 56 56" role="presentation">
        <circle
          cx="28"
          cy="28"
          r={radius}
          fill="none"
          stroke="var(--slate-4)"
          strokeWidth="5"
        />
        <circle
          cx="28"
          cy="28"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${arc} ${circumference}`}
          transform="rotate(-90 28 28)"
        />
      </svg>
      <span
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: size >= 64 ? 18 : 15,
          fontWeight: 600,
          color,
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {Math.round(score)}
      </span>
    </div>
  );
};

export default ScoreRing;

import { getBandDisplay } from "./qualityDisplay";
import styles from "./Quality.module.scss";

const VIEWBOX = 76;
const RADIUS = 32;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const arcLength = (score: number) =>
  (Math.min(Math.max(score, 0), 100) / 100) * CIRCUMFERENCE;

export default function QualityDonut({
  score,
  size = 104,
  ghostTo = null,
  showLabel = true,
}: {
  // null before there's a score
  score: number | null;
  size?: number;
  // A reachable score, drawn as a lighter arc past this one
  ghostTo?: number | null;
  showLabel?: boolean;
}) {
  const band = score === null ? null : getBandDisplay(score);
  const ghost =
    score !== null && ghostTo !== null && ghostTo > score ? ghostTo : score;
  const arc = (length: number) => `${length} ${CIRCUMFERENCE}`;
  const circle = {
    cx: VIEWBOX / 2,
    cy: VIEWBOX / 2,
    r: RADIUS,
    fill: "none",
    strokeWidth: 6,
  };

  return (
    <div className={styles.donut} style={{ width: size, height: size }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
        aria-hidden
      >
        <circle {...circle} stroke="var(--slate-4)" />
        {score !== null && band ? (
          <g transform={`rotate(-90 ${VIEWBOX / 2} ${VIEWBOX / 2})`}>
            <circle
              {...circle}
              className={styles.ghostArc}
              stroke={getBandDisplay(ghost ?? score).ghost}
              strokeLinecap="round"
              strokeDasharray={arc(arcLength(ghost ?? score))}
            />
            <circle
              {...circle}
              stroke={band.arc}
              strokeLinecap="round"
              strokeDasharray={arc(arcLength(score))}
            />
          </g>
        ) : null}
      </svg>
      {showLabel ? (
        <div className={styles.donutLabel}>
          <span
            className={styles.donutScore}
            style={{ fontSize: (size * 19) / VIEWBOX }}
          >
            {score === null ? "–" : Math.round(score)}
          </span>
          <span className={styles.donutOf}>of 100</span>
        </div>
      ) : null}
    </div>
  );
}

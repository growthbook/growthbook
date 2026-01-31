import clsx from "clsx";
import { NamespaceUsage } from "shared/types/organization";
import useOrgSettings from "@/hooks/useOrgSettings";
import { findGaps } from "@/services/features";
import styles from "./NamespaceUsageGraph.module.scss";

const percentFormatter = new Intl.NumberFormat(undefined, {
  style: "percent",
  maximumFractionDigits: 2,
});

export interface Props {
  usage: NamespaceUsage;
  namespace: string;
  featureId?: string;
  trackingKey?: string;
  range?: [number, number];
  ranges?: [number, number][];
  setRange?: (range: [number, number]) => void;
  title?: string;
}

export default function NamespaceUsageGraph({
  usage,
  namespace,
  featureId = "",
  trackingKey = "",
  range,
  ranges,
  setRange,
  title = "Allocation",
}: Props) {
  const { namespaces } = useOrgSettings();

  if (!namespaces?.length) return null;

  const gaps = findGaps(usage, namespace, featureId, trackingKey);

  return (
    <div>
      <div className="row align-items-center">
        <div className="col">
          <label className="mb-0">{title}</label>
        </div>
        <div className={clsx("col-auto", styles.legend)}>Legend:</div>
        <div className={clsx("col-auto", styles.legend)}>
          <div
            className={clsx(
              styles.legend_box,
              styles.used,
              "progress-bar-striped",
            )}
          />{" "}
          In-use
        </div>
        <div className={clsx("col-auto", styles.legend)}>
          <div className={clsx(styles.legend_box, styles.unused)} /> Available
        </div>
        {setRange && (
          <div className={clsx("col-auto", styles.legend)}>
            <div className={clsx(styles.legend_box, styles.selected)} />{" "}
            Selected
          </div>
        )}
      </div>
      <div className={clsx(styles.bar_holder, "progress-bar-striped")}>
        {gaps.map((g, i) => (
          <div
            key={`gap${i}`}
            className={clsx(styles.bar, styles.unused)}
            style={{
              left: `${+(g.start * 100).toFixed(4)}%`,
              width: `${+(g.end * 100 - g.start * 100).toFixed(4)}%`,
              cursor: setRange ? "pointer" : "default",
            }}
            onClick={(e) => {
              e.preventDefault();
              if (setRange) {
                setRange([g.start, g.end]);
              }
            }}
          />
        ))}
        {/* Display multiple ranges or single range */}
        {(ranges || (range ? [range] : [])).map((r, index) => (
          <div key={`range-${index}`}>
            <div
              className={styles.rangeSelected}
              style={{
                left: `${+(r[0] * 100).toFixed(4)}%`,
                width: `${+(r[1] * 100 - r[0] * 100).toFixed(4)}%`,
              }}
            ></div>
            <div
              className={styles.rangeMarker}
              style={{
                left: `${+(r[0] * 100).toFixed(4)}%`,
                width: `${+(r[1] * 100 - r[0] * 100).toFixed(4)}%`,
              }}
            >
              <span>{percentFormatter.format(r[1] - r[0])}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

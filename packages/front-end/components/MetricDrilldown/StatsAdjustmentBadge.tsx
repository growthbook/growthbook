import { FC, ReactNode } from "react";
import { PiWarningFill } from "react-icons/pi";
import { AdjustmentImpact } from "shared/experiments";
import Badge from "@/ui/Badge";
import Link from "@/ui/Link";
import Tooltip from "@/ui/Tooltip";
import { formatAdjustmentChange, formatAdjustmentQualifiers } from "./helpers";
import styles from "./StatsAdjustmentBadge.module.scss";

function formatImpact(impact: AdjustmentImpact): string {
  const qualifiers = formatAdjustmentQualifiers(impact);
  return `${formatAdjustmentChange(impact)}${
    qualifiers ? ` (${qualifiers})` : ""
  }.`;
}

const StatsAdjustmentBadge: FC<{
  /** Large impacts only, from `getLargeAdjustmentImpacts`. */
  impacts: AdjustmentImpact[];
  onClick?: () => void;
  /** Rendered after the badge, kept on the same line as it. */
  trailing?: ReactNode;
}> = ({ impacts, onClick, trailing }) => {
  if (!impacts.length) return null;

  const label = impacts.length === 1 ? impacts[0].label : "Stats Adjustments";

  const tooltip = (
    <>
      {impacts.length === 1 ? (
        <div>{formatImpact(impacts[0])}</div>
      ) : (
        impacts.map((impact) => (
          <div key={impact.field}>
            {impact.label}: {formatImpact(impact)}
          </div>
        ))
      )}
      {onClick ? <div>Click to view details.</div> : null}
    </>
  );

  const badge = (
    <Badge
      className={styles.badge}
      color="amber"
      variant="soft"
      size="sm"
      label={
        <>
          <PiWarningFill size={12} />
          {label}
        </>
      }
    />
  );

  // A space rather than a margin: it is dropped when the badge wraps to a new
  // line, so a wrapped badge stays flush with the metric name.
  return (
    <>
      {" "}
      <span className={styles.group}>
        <Tooltip content={tooltip}>
          {onClick ? (
            <Link underline="none" className={styles.link} onClick={onClick}>
              {badge}
            </Link>
          ) : (
            <span tabIndex={0} className={styles.wrapper}>
              {badge}
            </span>
          )}
        </Tooltip>
        {trailing}
      </span>
    </>
  );
};

export default StatsAdjustmentBadge;

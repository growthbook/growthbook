import { HiBadgeCheck } from "react-icons/hi";
import {
  ExperimentMetricInterface,
  isFactMetric,
  quantileMetricType,
} from "shared/experiments";
import { VscListTree } from "react-icons/vsc";
import React from "react";
import { FaExclamationTriangle } from "react-icons/fa";
import { useDefinitions } from "@/services/DefinitionsContext";
import Tooltip from "@/components/Tooltip/Tooltip";
import { getPercentileLabel } from "@/services/metrics";

export function PercentileLabel({
  metric,
}: {
  metric: ExperimentMetricInterface;
}) {
  if (
    isFactMetric(metric) &&
    quantileMetricType(metric) &&
    metric.quantileSettings
  ) {
    return (
      <span className="ml-2 small text-muted">
        {getPercentileLabel(metric.quantileSettings.quantile)}
      </span>
    );
  }
  return null;
}

export function OfficialBadge({
  type,
  managedBy,
  disableTooltip,
  showOfficialLabel,
}: {
  type: string;
  managedBy?: "" | "config" | "api";
  disableTooltip?: boolean;
  showOfficialLabel?: boolean;
}) {
  if (!managedBy) return null;

  return (
    <span className="ml-1 text-purple">
      <Tooltip
        body={
          disableTooltip ? (
            ""
          ) : (
            <>
              <h4>
                <HiBadgeCheck
                  style={{
                    fontSize: "1.2em",
                    lineHeight: "1em",
                    marginTop: "-2px",
                  }}
                  className="text-purple"
                />{" "}
                Official{" "}
                <span
                  style={{
                    textTransform: "capitalize",
                  }}
                >
                  {type}
                </span>
              </h4>
              This {type} is being managed by{" "}
              {managedBy === "config" ? (
                <>
                  a <code>config.yml</code> file
                </>
              ) : (
                <>the API</>
              )}
              . It is read-only and cannot be modified from within GrowthBook.
            </>
          )
        }
      >
        <HiBadgeCheck
          style={{ fontSize: "1.2em", lineHeight: "1em", marginTop: "-2px" }}
        />
        {showOfficialLabel ? (
          <span className="ml-1 badge badge-purple">Official</span>
        ) : null}
      </Tooltip>
    </span>
  );
}

export default function MetricName({
  id,
  disableTooltip,
  showOfficialLabel,
  showDescription,
  isGroup,
  allJoinable,
}: {
  id: string;
  disableTooltip?: boolean;
  showOfficialLabel?: boolean;
  showDescription?: boolean;
  isGroup?: boolean;
  allJoinable?: boolean;
}) {
  const { getExperimentMetricById, getMetricGroupById } = useDefinitions();
  const metric = getExperimentMetricById(id);

  if (isGroup) {
    // check if this is a metric group:
    const metricGroup = getMetricGroupById(id);
    if (!metricGroup) {
      return <>{id}</>;
    }
    return (
      <>
        <VscListTree className="mr-1" />
        {metricGroup.name}
        <span className="ml-1 small">
          ({metricGroup.metrics.length} metric
          {metricGroup.metrics.length === 0 ? "" : "s"})
        </span>
        {showDescription && metricGroup.description ? (
          <span className="text-muted">
            {" "}
            —{" "}
            {metricGroup?.description.length > 50
              ? metricGroup?.description.substring(0, 50) + "..."
              : metricGroup?.description}
          </span>
        ) : null}
        {!allJoinable && (
          <Tooltip
            className="ml-1 text-danger"
            body="Includes some metrics that are not joinable"
          >
            <FaExclamationTriangle />
          </Tooltip>
        )}
      </>
    );
  }

  if (!metric) return null;

  return (
    <>
      {metric.name}
      {showDescription && metric.description ? (
        <span className="text-muted">
          {" "}
          —{" "}
          {metric?.description.length > 50
            ? metric?.description.substring(0, 50) + "..."
            : metric?.description}
        </span>
      ) : (
        ""
      )}
      <OfficialBadge
        type="metric"
        managedBy={metric.managedBy}
        disableTooltip={disableTooltip}
        showOfficialLabel={showOfficialLabel}
      />
    </>
  );
}

import { HiBadgeCheck } from "react-icons/hi";
import {
  ExperimentMetricInterface,
  isFactMetric,
  quantileMetricType,
} from "shared/experiments";
import React from "react";
import { FaExclamationCircle, FaExclamationTriangle } from "react-icons/fa";
import clsx from "clsx";
import { PiArrowSquareOut, PiFolderDuotone } from "react-icons/pi";
import { Flex } from "@radix-ui/themes";
import { useDefinitions } from "@/services/DefinitionsContext";
import Tooltip from "@/components/Tooltip/Tooltip";
import { getPercentileLabel } from "@/services/metrics";
import HelperText from "@/ui/HelperText";

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
  metric: _metric, // if provided, will be used instead of id
  disableTooltip,
  showOfficialLabel,
  showDescription,
  filterConversionWindowMetrics,
  isGroup,
  metrics,
  showLink,
}: {
  id?: string;
  metric?: ExperimentMetricInterface;
  disableTooltip?: boolean;
  showOfficialLabel?: boolean;
  showDescription?: boolean;
  filterConversionWindowMetrics?: boolean;
  isGroup?: boolean;
  metrics?: { metric: ExperimentMetricInterface | null; joinable: boolean }[];
  showLink?: boolean;
}) {
  const { getExperimentMetricById, getMetricGroupById } = useDefinitions();
  const metric = _metric ?? getExperimentMetricById(id ?? "");

  if (isGroup) {
    // check if this is a metric group:
    const metricGroup = getMetricGroupById(id ?? "");
    if (!metricGroup) {
      return <>{id}</>;
    }
    const allJoinable = metrics?.every((m) => m.joinable) ?? true;
    const allNonConversionWindow = metrics?.every(
      (m) => m?.metric?.windowSettings?.type !== "conversion",
    );

    return (
      <Flex align="center">
        <PiFolderDuotone size={16} className="mr-1" />
        {metricGroup.name}
        <Tooltip
          className={clsx("px-1", {
            "text-danger": !allJoinable,
            "text-warning":
              filterConversionWindowMetrics && !allNonConversionWindow,
          })}
          body={
            <>
              {!allJoinable ? (
                <div className="mb-2">
                  <HelperText status="error">
                    Includes metrics that are not joinable
                  </HelperText>
                </div>
              ) : null}
              {filterConversionWindowMetrics && !allNonConversionWindow ? (
                <div className="mb-2">
                  <HelperText status="warning">
                    Includes metrics with conversion windows
                  </HelperText>
                </div>
              ) : null}
              {metrics && metrics.length > 0 ? (
                <>
                  <div>Metrics in group:</div>
                  <ul className="ml-0 pl-3 mb-0">
                    {metrics.map((m, i) => (
                      <li
                        key={i}
                        className={clsx({
                          "text-danger": !m.joinable,
                          "text-warning":
                            filterConversionWindowMetrics &&
                            m?.metric?.windowSettings?.type === "conversion",
                        })}
                      >
                        {m.metric?.name}
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </>
          }
        >
          <span className="ml-1 small">
            ({metricGroup.metrics.length} metric
            {metricGroup.metrics.length === 0 ? "" : "s"})
            {!allJoinable && (
              <FaExclamationCircle
                size={10}
                className="position-relative text-danger ml-1"
                style={{ top: -2 }}
              />
            )}
            {filterConversionWindowMetrics && !allNonConversionWindow ? (
              <FaExclamationTriangle
                size={10}
                className="position-relative text-warning ml-1"
                style={{ top: -2 }}
              />
            ) : null}
          </span>
        </Tooltip>
        {showDescription && metricGroup.description ? (
          <span className="text-muted">
            {" "}
            —{" "}
            {metricGroup?.description.length > 50
              ? metricGroup?.description.substring(0, 50) + "..."
              : metricGroup?.description}
          </span>
        ) : null}
      </Flex>
    );
  }

  if (!metric) return null;

  return (
    <>
      <span
        style={{
          color: "var(--color-text-high)",
        }}
      >
        {metric.name}
      </span>
      {showLink ? (
        <div className="mt-1 mb-2 small">
          <a
            href={`/metric/${metric.id}`}
            target="_blank"
            className="link-purple"
          >
            View details
            <PiArrowSquareOut className="ml-1" />
          </a>
        </div>
      ) : null}
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

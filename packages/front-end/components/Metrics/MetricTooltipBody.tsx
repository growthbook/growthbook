import clsx from "clsx";
import {
  ExperimentMetricInterface,
  isFactMetric,
  getConversionWindowHours,
} from "shared/experiments";
import React from "react";
import { isNullUndefinedOrEmpty } from "@/services/utils";
import { ExperimentTableRow } from "@/services/experiments";
import Markdown from "../Markdown/Markdown";
import SortedTags from "../Tags/SortedTags";
import styles from "./MetricToolTipBody.module.scss";
import MetricName from "./MetricName";

interface MetricToolTipCompProps {
  metric: ExperimentMetricInterface;
  row?: ExperimentTableRow;
  reportRegressionAdjustmentEnabled?: boolean;
  newUi?: boolean;
}

interface MetricInfo {
  show: boolean;
  label: string;
  body: string | number | JSX.Element;
  markdown?: boolean;
}

const MetricTooltipBody = ({
  metric,
  row,
  reportRegressionAdjustmentEnabled,
  newUi = false,
}: MetricToolTipCompProps): React.ReactElement => {
  function validMetricDescription(description: string): boolean {
    if (!description) return false;
    const regExp = new RegExp(/[A-Za-z0-9]/);
    return regExp.test(description);
  }
  const metricOverrideFields = row?.metricOverrideFields ?? [];

  const conversionWindowHours = getConversionWindowHours(metric);
  const metricHasNoConversionWindow =
    isFactMetric(metric) && !metric.hasConversionWindow;

  const metricInfo: MetricInfo[] = [
    {
      show: true,
      label: "Type",
      body: isFactMetric(metric) ? metric.metricType : metric.type,
    },
    {
      show: (metric.tags?.length ?? 0) > 0,
      label: "Tags",
      body: (
        <SortedTags
          tags={metric.tags}
          shouldShowEllipsis={false}
          useFlex={true}
        />
      ),
    },
    {
      show:
        !isNullUndefinedOrEmpty(metric.capping) && (metric.capValue ?? 0) !== 0,
      label: `Capping (${metric.capping})`,
      body: metric.capValue ?? 0,
    },
    {
      show:
        !isNullUndefinedOrEmpty(metric.conversionDelayHours) &&
        (metric.conversionDelayHours !== 0 ||
          metricOverrideFields.includes("conversionDelayHours")),
      label: "Conversion Delay Hours",
      body: (
        <>
          {metric.conversionDelayHours}
          {metricOverrideFields.includes("conversionDelayHours") ? (
            <small className="text-purple ml-1">(override)</small>
          ) : null}
        </>
      ),
    },
    {
      show:
        !isNullUndefinedOrEmpty(conversionWindowHours) &&
        !metricHasNoConversionWindow,
      label: "Conversion Window Hours",
      body: (
        <>
          {conversionWindowHours}
          {metricOverrideFields.includes("conversionWindowHours") ? (
            <small className="text-purple ml-1">(override)</small>
          ) : null}
        </>
      ),
    },
  ];

  if (reportRegressionAdjustmentEnabled && row) {
    metricInfo.push({
      show: true,
      label: "CUPED",
      body: (
        <>
          {row?.regressionAdjustmentStatus?.regressionAdjustmentEnabled
            ? "Enabled"
            : "Disabled"}
          {metricOverrideFields.includes("regressionAdjustmentEnabled") ? (
            <small className="text-purple ml-1">(override)</small>
          ) : null}
        </>
      ),
    });
    if (row?.regressionAdjustmentStatus?.regressionAdjustmentEnabled) {
      metricInfo.push({
        show: true,
        label: "CUPED Lookback (days)",
        body: (
          <>
            {row?.regressionAdjustmentStatus?.regressionAdjustmentDays}
            {metricOverrideFields.includes("regressionAdjustmentDays") ? (
              <small className="text-purple ml-1">(override)</small>
            ) : null}
          </>
        ),
      });
    }
  }

  metricInfo.push({
    show: validMetricDescription(metric.description),
    label: "Description",
    body: metric.description,
    markdown: true,
  });

  if (newUi) {
    return (
      <div>
        <h4>
          <MetricName id={metric.id} showOfficialLabel disableTooltip />
        </h4>
        <table className="table table-sm table-bordered text-left mb-0">
          <tbody>
            {metricInfo
              .filter((i) => i.show)
              .map(({ label, body, markdown }, index) => (
                <tr key={`metricInfo${index}`}>
                  <td
                    className="text-right font-weight-bold py-1 align-middle"
                    style={{
                      width: 120,
                      border: "1px solid var(--border-color-100)",
                      fontSize: "12px",
                      lineHeight: "14px",
                    }}
                  >{`${label}`}</td>
                  <td
                    className="py-1 align-middle"
                    style={{
                      minWidth: 180,
                      border: "1px solid var(--border-color-100)",
                      fontSize: "12px",
                      lineHeight: "14px",
                    }}
                  >
                    {markdown ? (
                      <div
                        className={clsx("border rounded p-1", styles.markdown)}
                      >
                        <Markdown>{body}</Markdown>
                      </div>
                    ) : (
                      <span className="font-weight-normal">{body}</span>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="text-left">
      {metricInfo
        .filter((i) => i.show)
        .map(({ label, body, markdown }, index) => (
          <div key={`metricInfo${index}`} style={{ marginBottom: "0.2em" }}>
            <strong>{`${label}: `}</strong>
            {markdown ? (
              <div className={clsx("border rounded p-1", styles.markdown)}>
                <Markdown>{body}</Markdown>
              </div>
            ) : (
              <span className="font-weight-normal">{body}</span>
            )}
          </div>
        ))}
    </div>
  );
};

export default MetricTooltipBody;

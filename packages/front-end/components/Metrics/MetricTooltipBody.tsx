import { MetricInterface } from "back-end/types/metric";
import clsx from "clsx";
import { isNullUndefinedOrEmpty } from "@/services/utils";
import { ExperimentTableRow } from "@/services/experiments";
import Markdown from "../Markdown/Markdown";
import SortedTags from "../Tags/SortedTags";
import styles from "./MetricToolTipBody.module.scss";

interface MetricToolTipCompProps {
  metric: MetricInterface;
  row?: ExperimentTableRow;
  reportRegressionAdjustmentEnabled?: boolean;
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
}: MetricToolTipCompProps): React.ReactElement => {
  function validMetricDescription(description: string): boolean {
    if (!description) return false;
    const regExp = new RegExp(/[A-Za-z0-9]/);
    return regExp.test(description);
  }

  const metricInfo: MetricInfo[] = [
    {
      show: true,
      label: "Type",
      body: metric.type,
    },
    {
      // @ts-expect-error TS(2532) If you come across this, please fix it!: Object is possibly 'undefined'.
      show: metric.tags?.length > 0,
      label: "Tags",
      body: <SortedTags tags={metric.tags} />,
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
        metric.conversionDelayHours !== 0,
      label: "Conversion Delay Hours",
      // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'number | undefined' is not assignable to typ... Remove this comment to see the full error message
      body: metric.conversionDelayHours,
    },
    {
      show: !isNullUndefinedOrEmpty(metric.conversionWindowHours),
      label: "Conversion Window Hours",
      // @ts-expect-error TS(2322) If you come across this, please fix it!: Type 'number | undefined' is not assignable to typ... Remove this comment to see the full error message
      body: metric.conversionWindowHours,
    },
  ];

  if (reportRegressionAdjustmentEnabled && row) {
    metricInfo.push({
      show: true,
      label: "CUPED",
      body: row?.regressionAdjustmentStatus?.regressionAdjustmentEnabled
        ? "Enabled"
        : "Disabled",
    });
    if (row?.regressionAdjustmentStatus?.regressionAdjustmentEnabled) {
      metricInfo.push({
        show: true,
        label: "CUPED Lookback (days)",
        body: row?.regressionAdjustmentStatus?.regressionAdjustmentDays,
      });
    }
  }

  metricInfo.push({
    show: validMetricDescription(metric.description),
    label: "Description",
    body: metric.description,
    markdown: true,
  });

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

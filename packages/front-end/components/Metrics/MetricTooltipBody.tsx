import { MetricInterface } from "back-end/types/metric";
import { isNullUndefinedOrEmpty } from "../../services/utils";
import SortedTags from "../Tags/SortedTags";

interface MetricToolTipCompProps {
  metric: MetricInterface;
}

interface MetricInfo {
  show: boolean;
  label: string;
  body: string | number | JSX.Element;
}

const MetricTooltipBody = ({
  metric,
}: MetricToolTipCompProps): React.ReactElement => {
  function truncateMetricDescription(metricDescription: string) {
    if (!metricDescription) return;
    if (metricDescription.length < 300) return metricDescription;
    return `${metricDescription.substring(0, 300)}...`;
  }

  function validMetricDescription(description: string): boolean {
    if (!description) return false;
    const regExp = new RegExp(/[A-Za-z0-9]/);
    return regExp.test(description);
  }

  const metricInfo: MetricInfo[] = [
    {
      show: validMetricDescription(metric.description),
      label: "Description",
      body: truncateMetricDescription(metric.description),
    },
    {
      show: true,
      label: "Type",
      body: metric.type,
    },
    {
      show: metric.tags?.length > 0,
      label: "Tags",
      body: <SortedTags tags={metric.tags} />,
    },
    {
      show: !isNullUndefinedOrEmpty(metric.cap) && metric.cap !== 0,
      label: "Cap",
      body: metric.cap,
    },
    {
      show:
        !isNullUndefinedOrEmpty(metric.conversionDelayHours) &&
        metric.conversionDelayHours !== 0,
      label: "Conversion Delay Hours",
      body: metric.conversionDelayHours,
    },
    {
      show: !isNullUndefinedOrEmpty(metric.conversionWindowHours),
      label: "Conversion Window Hours",
      body: metric.conversionWindowHours,
    },
  ];

  return (
    <div className="text-left">
      {metricInfo
        .filter((i) => i.show)
        .map(({ label, body }, index) => (
          <div key={`metricInfo${index}`}>
            <strong>{`${label}: `}</strong>
            <span className="font-weight-normal">{body}</span>
          </div>
        ))}
    </div>
  );
};

export default MetricTooltipBody;

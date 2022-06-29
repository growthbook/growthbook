import { MetricInterface } from "back-end/types/metric";
import SortedTags from "../Tags/SortedTags";
import MetricTooltipBodyRow from "./MetricTooltipBodyRow";

interface MetricToolTipCompProps {
  metric: MetricInterface;
}

const MetricTooltipBody = ({
  metric,
}: MetricToolTipCompProps): React.ReactElement => {
  function truncateMetricDescription(metricDescription: string) {
    if (!metricDescription) return;
    if (metricDescription.length < 300) return metricDescription;
    return `${metricDescription.substring(0, 300)}...`;
  }

  return (
    <div className="text-left">
      {console.log(metric)}
      <MetricTooltipBodyRow
        property={metric.description}
        label={"Description:"}
        body={truncateMetricDescription(metric.description)}
      />
      <MetricTooltipBodyRow
        property={metric.type}
        label={"Type:"}
        body={metric.type}
      />
      <MetricTooltipBodyRow
        property={metric.tags}
        label={"Tags:"}
        body={<SortedTags tags={metric.tags} color="purple" />}
      />
      <MetricTooltipBodyRow
        property={metric.cap}
        label={"Cap:"}
        body={metric.cap}
      />
      <MetricTooltipBodyRow
        property={metric.conversionDelayHours}
        label={"Conversion Delay Hours:"}
        body={metric.conversionDelayHours}
      />
      <MetricTooltipBodyRow
        property={metric.conversionWindowHours}
        label={"Conversion Window Hours:"}
        body={metric.conversionWindowHours}
      />
    </div>
  );
};

export default MetricTooltipBody;

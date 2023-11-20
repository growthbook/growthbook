import { isFactMetricId } from "shared/experiments";

export default function FactBadge({ metricId }: { metricId: string }) {
  if (!isFactMetricId(metricId)) return null;

  return <span className="badge badge-purple ml-1">FACT</span>;
}

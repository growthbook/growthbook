import { FactMetricType } from "back-end/types/fact-table";
import { capitalizeFirstLetter } from "@/services/utils";

export default function FactMetricTypeDisplayName({
  type,
}: {
  type: FactMetricType;
}) {
  switch (type) {
    case "proportion":
    case "mean":
    case "ratio":
    case "quantile":
      return <>{capitalizeFirstLetter(type)}</>;
    case "dailyParticipation":
      return <>Daily Participation</>;
    default:
      return <>{type}</>;
  }
}

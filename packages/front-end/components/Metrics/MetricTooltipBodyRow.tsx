import { MetricType } from "back-end/types/metric";
import { isNullUndefinedOrEmpty } from "../../services/utils";

interface RowCompProps {
  property: string | MetricType | string[] | number;
  label: string;
  body: string | number | JSX.Element;
}

function MetricTooltipBodyRow({
  property,
  label,
  body,
}: RowCompProps): JSX.Element {
  return (
    <>
      {!isNullUndefinedOrEmpty(property) && (
        <div>
          <strong>{label}</strong> {body}
        </div>
      )}
    </>
  );
}

export default MetricTooltipBodyRow;

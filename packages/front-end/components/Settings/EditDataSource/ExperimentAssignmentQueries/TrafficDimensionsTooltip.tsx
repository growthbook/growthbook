import { ReactNode } from "react";
import Tooltip from "@/components/Tooltip/Tooltip";

export function TrafficDimensionsTooltip({
  children,
}: {
  children?: ReactNode;
}) {
  return (
    <Tooltip
      body={
        <div>
          Whenever your overall snapshot analysis updates, we will execute
          another query to pre-compute your overall traffic splits and
          dimension-specific traffic splits. This setting selects which
          dimension splits we compute by default. More dimensions, especially
          those with high cardinality, might cause errors computing traffic
          results by returning too many rows.
        </div>
      }
    >
      {children}
    </Tooltip>
  );
}

import { ReactNode } from "react";
import Tooltip from "../Tooltip";

export function AttributionModelTooltip({ children }: { children: ReactNode }) {
  return (
    <Tooltip
      body={
        <div>
          <div className="mb-2">
            Determines how we attribute metric conversions to this experiment.
          </div>
          <div className="mb-2">
            <strong>First Exposure</strong> - Single conversion window based on
            the first time the user views the experiment.
          </div>
          <div>
            <strong>All Exposures</strong> - Multiple conversion windows, one
            for each time the user views the experiment.
          </div>
        </div>
      }
    >
      {children}
    </Tooltip>
  );
}

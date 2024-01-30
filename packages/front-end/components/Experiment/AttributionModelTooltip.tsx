import { ReactNode } from "react";
import Tooltip from "../Tooltip/Tooltip";

export function AttributionModelTooltip({ children }: { children: ReactNode }) {
  return (
    <Tooltip
      body={
        <div>
          <div className="mb-2">
            Determines whether we respect conversion windows (lookback windows
            cannot be overriden this way).
          </div>
          <div className="mb-2">
            <strong>Respect Conversion Windows</strong> - Builds a single
            conversion window off of each user{"'"}s first exposure for metrics
            with conversion windows.
          </div>
          <div>
            <strong>Ignore Conversion Windows</strong> - Override all metric
            conversion windows and count all metric values from user{"'"}s first
            exposure to the end of the experiment.
          </div>
        </div>
      }
    >
      {children}
    </Tooltip>
  );
}

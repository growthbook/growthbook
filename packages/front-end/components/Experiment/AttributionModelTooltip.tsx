import { ReactNode } from "react";
import Tooltip from "../Tooltip/Tooltip";

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
            <strong>Experiment Duration</strong> - Count all conversions that
            happen between viewing the experiment and the experiment end date.
            Ignore metric conversion windows.
          </div>
        </div>
      }
    >
      {children}
    </Tooltip>
  );
}

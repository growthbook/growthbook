import { ReactNode } from "react";
import Tooltip from "../Tooltip";

export function AttributionModelTooltip({ children }: { children: ReactNode }) {
  return (
    <Tooltip
      body={
        <div>
          Determines how we attribute metric conversions to this experiment.
          <ul>
            <li>
              <strong>First Exposure</strong> - Single conversion window based
              on the first time the user views the experiment.
            </li>
            <li>
              <strong>All Exposures</strong> - Multiple conversion windows, one
              for each time the user views the experiment.
            </li>
          </ul>
        </div>
      }
    >
      {children}
    </Tooltip>
  );
}

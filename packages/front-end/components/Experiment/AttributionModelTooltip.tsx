import { ReactNode } from "react";
import Tooltip from "@/components/Tooltip/Tooltip";

export function AttributionModelTooltip({ children }: { children: ReactNode }) {
  return (
    <Tooltip
      body={
        <div>
          <div className="mb-2">
            <strong>Use Metric Settings</strong> - Respect each metric{"'"}s
            window (none, conversion, or lookback) settings.
          </div>
          <div className="mb-2">
            <strong>Ignore Conversion Windows</strong> - Count all metric values
            from user{"'"}s first exposure to the end of the experiment,
            regardless of the metrics{"'"} conversion or lookback window.
          </div>
          <div>
            <strong>Use Custom Lookback Window</strong> - Override all metric
            windows with a lookback period to either a fixed date or set time in
            the past until the end of the experiment.
          </div>
        </div>
      }
    >
      {children}
    </Tooltip>
  );
}

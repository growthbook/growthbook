import { ReactNode } from "react";
import { Trans } from "@lingui/react/macro";
import Tooltip from "@/components/Tooltip/Tooltip";

export function AttributionModelTooltip({ children }: { children: ReactNode }) {
  return (
    <Tooltip
      body={
        <div>
          <div className="mb-2">
            <Trans>
              <strong>Respect metric settings</strong> - Respect each metric
              {"'"}s window (none, conversion, or lookback) settings.
            </Trans>
          </div>
          <div className="mb-2">
            <Trans>
              <strong>Ignore conversion windows</strong> - Count all metric
              values from user{"'"}s first exposure to the end of the
              experiment, regardless of the metrics{"'"} conversion or lookback
              window.
            </Trans>
          </div>
          <div>
            <Trans>
              <strong>Use custom lookback window</strong> - Override all metric
              windows with a lookback period to either a fixed date or set time
              in the past until the end of the experiment.
            </Trans>
          </div>
        </div>
      }
    >
      {children}
    </Tooltip>
  );
}

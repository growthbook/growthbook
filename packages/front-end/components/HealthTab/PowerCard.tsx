import { useEffect } from "react";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import Badge from "@/components/Radix/Badge";
import { IssueValue } from "./IssueTags";

export function PowerCard({
  snapshot,
  onNotify,
}: {
  snapshot: ExperimentSnapshotInterface;
  onNotify: (issue: IssueValue) => void;
}) {
  const midPowerResults = snapshot.health?.power;
  console.log(midPowerResults);

  useEffect(() => {
    if (midPowerResults?.lowPowerWarning) {
      onNotify({
        label: "Low Powered",
        value: "power-card",
      });
    }
  }, [midPowerResults, onNotify]);

  if (!midPowerResults) {
    return null;
  }

  return (
    <div className="appbox container-fluid my-4 pl-3 py-3">
      <h2 className="d-inline">Power</h2>{" "}
      {midPowerResults?.lowPowerWarning ? (
        <>
          <Badge label="Low Powered" color="amber" />
          <div className="mt-1">
            Your experiment is low-powered and will likely not be statistically
            significant before the configured experiment duration.
          </div>
          <div className="mt-1">
            You can increase the power of your experiment by increasing the
            experiment duration (or increasing the exposure for more users).
          </div>
        </>
      ) : null}
      {midPowerResults.metricVariationPowerResults.map((r) => (
        <div key={r.metric}>
          {r.metric}-{r.variation}-{r.power}-{r.effectSize}-{r.additionalDays}-
          {r.calculationSucceeded ? "Succeeded" : "Failed"}-
          {r.errorMessage ? r.errorMessage : "No error"}-
          {r.lowPowerWarning ? "Low Powered" : "Not low Powered"}-
          {r.newDailyUsers}
        </div>
      ))}
    </div>
  );
}

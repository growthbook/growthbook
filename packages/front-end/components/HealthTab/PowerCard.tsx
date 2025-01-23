import { useEffect } from "react";
import { Separator } from "@radix-ui/themes";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import Link from "@/components/Radix/Link";
import Callout from "@/components/Radix/Callout";
import { useUser } from "@/services/UserContext";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { IssueValue } from "./IssueTags";
import { StatusBadge } from "./StatusBadge";

export function PowerCard({
  experiment,
  snapshot,
  onNotify,
}: {
  experiment: ExperimentInterfaceStringDates;
  snapshot: ExperimentSnapshotInterface;
  onNotify: (issue: IssueValue) => void;
}) {
  const { hasCommercialFeature } = useUser();
  const snapshotPower = snapshot.health?.power;
  const hasMidExperimentPowerFeature = hasCommercialFeature(
    "mid-experiment-power"
  );

  const isLowPowered = snapshotPower?.isLowPowered ?? false;
  const phase = experiment.phases[snapshot.phase];

  useEffect(() => {
    if (isLowPowered) {
      onNotify({
        label: "Low powered",
        value: "power-card",
      });
    }
  }, [isLowPowered, onNotify]);

  const content = !hasMidExperimentPowerFeature ? (
    <Callout status="info">
      You can read more about this feature in our{" "}
      <Link target="_blank" href="https://docs.growthbook.io/statistics/power">
        Power Analysis documentation
      </Link>
      .
    </Callout>
  ) : !isLowPowered ? (
    <Callout status="success">
      Your experiment is healthy and will likely be statistically significant
      before the experiment duration.
    </Callout>
  ) : (
    <>
      <Callout status="warning" mb="2">
        Your experiment is low-powered and will likely not be statistically
        significant before the configured end date.
      </Callout>
      <ul>
        {phase.coverage === 1 ? (
          <li>
            Consider increasing the traffic percentage for this experiment which
            is currently at {phase.coverage * 100}%.
          </li>
        ) : null}
        {snapshot.settings.variations.length > 2 ? (
          <li>
            Consider reducing the number of variations for this experiment.
          </li>
        ) : null}
        {snapshot.settings.goalMetrics.length > 3 ? (
          <li>
            Consider reducing the number of goal metrics for this experiment.
          </li>
        ) : null}
      </ul>
    </>
  );

  return (
    <div id="power-card" style={{ scrollMarginTop: "100px" }}>
      <div className="appbox container-fluid my-4 pl-3 py-3">
        <PremiumTooltip commercialFeature="mid-experiment-power">
          <h2 className="d-flex">Experiment Power</h2>{" "}
          {hasMidExperimentPowerFeature && isLowPowered ? (
            <StatusBadge status="unhealthy" />
          ) : null}
        </PremiumTooltip>
        <p className="mt-1">
          Shows the likelihood of your experiment being statistically
          significant before the experiment duration.
        </p>
        <Separator size="4" my="3" />
        {content}
      </div>
    </div>
  );
}

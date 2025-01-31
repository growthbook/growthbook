import { useEffect } from "react";
import { useSWRConfig } from "swr";
import { Flex, Separator, Text, Tooltip } from "@radix-ui/themes";
import { PiInfo, PiX } from "react-icons/pi";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import Link from "@/components/Radix/Link";
import Callout from "@/components/Radix/Callout";
import Button from "@/components/Radix/Button";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
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
  const { apiCall, orgId } = useAuth();
  const { mutate } = useSWRConfig();
  const { hasCommercialFeature } = useUser();
  const snapshotPower = snapshot.health?.power;
  const hasMidExperimentPowerFeature = hasCommercialFeature(
    "mid-experiment-power"
  );

  const hasPowerData = snapshotPower !== undefined;
  const isLowPowered = snapshotPower?.isLowPowered ?? false;
  const phase = experiment.phases[snapshot.phase];

  const isDismissed =
    experiment.dismissedWarnings?.includes("low-power") ?? false;
  const isDismissable = hasMidExperimentPowerFeature && isLowPowered;

  const toggleDismissed = async () => {
    await apiCall(`/experiment/${experiment.id}`, {
      method: "POST",
      body: JSON.stringify({
        dismissedWarnings: isDismissed
          ? (experiment.dismissedWarnings || []).filter(
              (w) => w !== "low-power"
            )
          : [...(experiment.dismissedWarnings || []), "low-power"],
      }),
    });
    mutate(`${orgId}::/experiment/${experiment.id}`);
  };

  useEffect(() => {
    if (
      experiment.dismissedWarnings?.includes("low-power") === false &&
      isLowPowered
    ) {
      onNotify({
        label: "Low powered",
        value: "power-card",
      });
    }
  }, [experiment, isLowPowered, onNotify]);

  const content = !hasMidExperimentPowerFeature ? (
    <Callout status="info">
      Learn more in our{" "}
      <Link target="_blank" href="https://docs.growthbook.io/statistics/power">
        Power Analysis docs
      </Link>
      .
    </Callout>
  ) : !hasPowerData ? (
    <Callout status="info">
      We have not calculated power for this experiment yet. Refresh the Results
      to see the power data.
    </Callout>
  ) : !isLowPowered ? (
    <Callout status="success">
      Your experiment is healthy. Conclusive results are likely before the
      anticipated experiment duration.
    </Callout>
  ) : (
    <>
      <Callout status="warning" mb="2">
        Your experiment is low-powered. Conclusive results are unlikely by the
        anticipated experiment duration.
      </Callout>
      Recommendations:
      <ul>
        {phase.coverage !== 1 ? (
          <li>
            Consider increasing the traffic percentage above{" "}
            {phase.coverage * 100}%
          </li>
        ) : null}
        {snapshot.settings.variations.length > 2 ? (
          <li>Consider reducing the number of variations</li>
        ) : null}
        {snapshot.settings.goalMetrics.length > 3 ? (
          <li>Consider reducing the number of goal metrics</li>
        ) : null}
      </ul>
    </>
  );

  return (
    <div id="power-card" style={{ scrollMarginTop: "100px" }}>
      <div className="appbox container-fluid mb-4 pl-3 py-3">
        <Flex justify="between" mb="2">
          <PremiumTooltip commercialFeature="mid-experiment-power">
            <h2 className="d-flex mb-0">Experiment Power</h2>{" "}
            {hasMidExperimentPowerFeature && isLowPowered ? (
              <StatusBadge status="unhealthy" />
            ) : null}
          </PremiumTooltip>
          {isDismissable && !isDismissed ? (
            <Tooltip content={"Dismiss this alert"}>
              <Button onClick={toggleDismissed} variant="ghost">
                <PiX />
              </Button>
            </Tooltip>
          ) : null}
        </Flex>

        {isDismissable && isDismissed ? (
          <Text size="2" color="gray">
            <PiInfo />
            This alert was dismissed, it will not consider the experiment
            Unhealthy even if problems are detected. Click{" "}
            <Link onClick={toggleDismissed}>here</Link> to reenable it.
          </Text>
        ) : null}

        <p className="mt-1">
          Shows the likelihood of conclusive results before the experiment
          duration
        </p>
        <Separator size="4" my="3" />
        {content}
      </div>
    </div>
  );
}

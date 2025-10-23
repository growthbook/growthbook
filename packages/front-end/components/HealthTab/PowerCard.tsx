import { useEffect } from "react";
import { useSWRConfig } from "swr";
import { Box, Flex, Separator, Text, Tooltip } from "@radix-ui/themes";
import { PiArrowSquareOut, PiInfo, PiX } from "react-icons/pi";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import Link from "@/ui/Link";
import Callout from "@/ui/Callout";
import Button from "@/ui/Button";
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
  const hasMidExperimentPowerFeature =
    hasCommercialFeature("decision-framework");

  const phase = experiment.phases[snapshot.phase];
  const hasPowerData = snapshotPower !== undefined;
  const isLowPowered = snapshotPower?.isLowPowered ?? false;

  const canBeMuted = hasMidExperimentPowerFeature && isLowPowered;
  const isMuted = experiment.dismissedWarnings?.includes("low-power") ?? false;

  const toggleMuteAlert = async () => {
    const existingDismissedWarnings = experiment.dismissedWarnings ?? [];
    await apiCall(`/experiment/${experiment.id}`, {
      method: "POST",
      body: JSON.stringify({
        dismissedWarnings: isMuted
          ? existingDismissedWarnings.filter((w) => w !== "low-power")
          : [...existingDismissedWarnings, "low-power"],
      }),
    });
    // Ensure the experiment is refetched to get the updated dismissedWarnings
    mutate(`${orgId}::/experiment/${experiment.id}`);
  };

  useEffect(() => {
    if (isLowPowered && !experiment.dismissedWarnings?.includes("low-power")) {
      onNotify({
        label: "Low powered",
        value: "power-card",
      });
    }
  }, [experiment.dismissedWarnings, isLowPowered, onNotify]);

  const renderUpsell = () => (
    <Callout status="info">
      Learn more about Power Analysis.{" "}
      <Link target="_blank" href="https://docs.growthbook.io/statistics/power">
        View docs
        <Box display="inline-block" ml="1">
          <PiArrowSquareOut />
        </Box>
      </Link>
    </Callout>
  );

  const renderNoPowerData = () => (
    <Callout status="info">
      We have not calculated power for this experiment yet. Refresh the Results
      to see the power data.
    </Callout>
  );

  const renderHealthyExperiment = () => (
    <Callout status="success">
      Your experiment is healthy. Conclusive results are likely before the
      anticipated experiment duration.
    </Callout>
  );

  const renderLowPowerRecommendations = () => {
    const recommendations: React.ReactNode[] = [];

    if (phase.coverage !== 1) {
      recommendations.push(
        <li key="coverage">
          Consider increasing the traffic percentage above{" "}
          {phase.coverage * 100}%
        </li>,
      );
    }

    if (snapshot.settings.variations.length > 2) {
      recommendations.push(
        <li key="variations">Consider reducing the number of variations</li>,
      );
    }

    if (snapshot.settings.goalMetrics.length > 3) {
      recommendations.push(
        <li key="metrics">Consider reducing the number of goal metrics</li>,
      );
    }

    return (
      <>
        <Callout status="warning" mb="2">
          Your experiment is low-powered. Conclusive results are unlikely by the
          anticipated experiment duration.
        </Callout>
        {recommendations.length > 0 && (
          <>
            Recommendations:
            <ul>{recommendations}</ul>
          </>
        )}
      </>
    );
  };

  const content = !hasMidExperimentPowerFeature
    ? renderUpsell()
    : !hasPowerData
      ? renderNoPowerData()
      : !isLowPowered
        ? renderHealthyExperiment()
        : renderLowPowerRecommendations();

  return (
    <div id="power-card" style={{ scrollMarginTop: "100px" }}>
      <div className="appbox container-fluid mb-4 pl-3 py-3">
        <Flex justify="between" mb="2">
          <Flex align="center" gap="2">
            <h2 className="d-flex mb-0">Experiment Power</h2>
            <PremiumTooltip commercialFeature="decision-framework" />
            {hasMidExperimentPowerFeature && isLowPowered ? (
              <StatusBadge status="unhealthy" />
            ) : null}
          </Flex>

          {canBeMuted && !isMuted ? (
            <Tooltip content={"Mute this alert"}>
              <Button onClick={toggleMuteAlert} variant="ghost">
                <PiX />
              </Button>
            </Tooltip>
          ) : null}
        </Flex>

        {canBeMuted && isMuted ? (
          <Text size="2" color="gray">
            <PiInfo />
            This alert was muted, it will not consider the experiment Unhealthy
            even if problems are detected. Click{" "}
            <Link onClick={toggleMuteAlert}>here</Link> to reenable it.
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

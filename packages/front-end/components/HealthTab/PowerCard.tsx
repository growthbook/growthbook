import { useEffect } from "react";
import { Box, Flex, Separator } from "@radix-ui/themes";
import { PiArrowSquareOut } from "react-icons/pi";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import Link from "@/ui/Link";
import Callout from "@/ui/Callout";
import { useUser } from "@/services/UserContext";
import { coveragePercentFormatter } from "@/services/utils";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { SCROLL_MARGIN_UNDER_TABS } from "@/components/Layout/constants";
import { IssueValue } from "./IssueTags";
import { StatusBadge } from "./StatusBadge";
import { MuteAlertButton, MutedAlertNote, useMuteAlert } from "./MuteAlert";

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
  const hasMidExperimentPowerFeature =
    hasCommercialFeature("decision-framework");

  const phase = experiment.phases[snapshot.phase];
  const hasPowerData = snapshotPower !== undefined;
  const isLowPowered = snapshotPower?.isLowPowered ?? false;

  const canBeMuted = hasMidExperimentPowerFeature && isLowPowered;
  const mute = useMuteAlert(experiment, "low-power");

  useEffect(() => {
    if (isLowPowered && !mute.isMuted) {
      onNotify({
        label: "Low powered",
        value: "power-card",
      });
    }
  }, [mute.isMuted, isLowPowered, onNotify]);

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
          {coveragePercentFormatter.format(phase.coverage)}
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
    <div id="power-card" style={{ scrollMarginTop: SCROLL_MARGIN_UNDER_TABS }}>
      <div className="appbox container-fluid mb-4 pl-3 py-3">
        <Flex justify="between" mb="2">
          <Flex align="center" gap="2">
            <h2 className="d-flex mb-0">Experiment Power</h2>
            <PremiumTooltip commercialFeature="decision-framework" />
            {hasMidExperimentPowerFeature && isLowPowered ? (
              <StatusBadge status="unhealthy" />
            ) : null}
          </Flex>

          {canBeMuted && !mute.isMuted ? (
            <MuteAlertButton onClick={mute.toggle} />
          ) : null}
        </Flex>

        {canBeMuted && mute.isMuted ? (
          <MutedAlertNote onUnmute={mute.toggle} />
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

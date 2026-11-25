import { useEffect } from "react";
import { useSWRConfig } from "swr";
import { Trans, useLingui } from "@lingui/react/macro";
import { Box, Flex, Separator, Text, Tooltip } from "@radix-ui/themes";
import { PiArrowSquareOut, PiInfo, PiX } from "react-icons/pi";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import Link from "@/ui/Link";
import Callout from "@/ui/Callout";
import Button from "@/ui/Button";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import { coveragePercentFormatter } from "@/services/utils";
import PremiumTooltip from "@/components/Marketing/PremiumTooltip";
import { SCROLL_MARGIN_UNDER_TABS } from "@/components/Layout/constants";
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
  const { t } = useLingui();
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
        label: t`Low powered`,
        value: "power-card",
      });
    }
  }, [experiment.dismissedWarnings, isLowPowered, onNotify, t]);

  const renderUpsell = () => (
    <Callout status="info">
      <Trans>Learn more about Power Analysis.</Trans>{" "}
      <Link target="_blank" href="https://docs.growthbook.io/statistics/power">
        <Trans>View docs</Trans>
        <Box display="inline-block" ml="1">
          <PiArrowSquareOut />
        </Box>
      </Link>
    </Callout>
  );

  const renderNoPowerData = () => (
    <Callout status="info">
      <Trans>
        We have not calculated power for this experiment yet. Refresh the
        Results to see the power data.
      </Trans>
    </Callout>
  );

  const renderHealthyExperiment = () => (
    <Callout status="success">
      <Trans>
        Your experiment is healthy. Conclusive results are likely before the
        anticipated experiment duration.
      </Trans>
    </Callout>
  );

  const renderLowPowerRecommendations = () => {
    const recommendations: React.ReactNode[] = [];

    if (phase.coverage !== 1) {
      const coverage = coveragePercentFormatter.format(phase.coverage);
      recommendations.push(
        <li key="coverage">
          <Trans>
            Consider increasing the traffic percentage above {coverage}
          </Trans>
        </li>,
      );
    }

    if (snapshot.settings.variations.length > 2) {
      recommendations.push(
        <li key="variations">
          <Trans>Consider reducing the number of variations</Trans>
        </li>,
      );
    }

    if (snapshot.settings.goalMetrics.length > 3) {
      recommendations.push(
        <li key="metrics">
          <Trans>Consider reducing the number of goal metrics</Trans>
        </li>,
      );
    }

    return (
      <>
        <Callout status="warning" mb="2">
          <Trans>
            Your experiment is low-powered. Conclusive results are unlikely by
            the anticipated experiment duration.
          </Trans>
        </Callout>
        {recommendations.length > 0 && (
          <>
            <Trans>Recommendations:</Trans>
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
            <h2 className="d-flex mb-0">
              <Trans>Experiment Power</Trans>
            </h2>
            <PremiumTooltip commercialFeature="decision-framework" />
            {hasMidExperimentPowerFeature && isLowPowered ? (
              <StatusBadge status="unhealthy" />
            ) : null}
          </Flex>

          {canBeMuted && !isMuted ? (
            <Tooltip content={t`Mute this alert`}>
              <Button onClick={toggleMuteAlert} variant="ghost">
                <PiX />
              </Button>
            </Tooltip>
          ) : null}
        </Flex>

        {canBeMuted && isMuted ? (
          <Text size="2" color="gray">
            <PiInfo />
            <Trans>
              This alert was muted, it will not consider the experiment
              Unhealthy even if problems are detected. Click{" "}
              <Link onClick={toggleMuteAlert}>here</Link> to re-enable it.
            </Trans>
          </Text>
        ) : null}

        <p className="mt-1">
          <Trans>
            Shows the likelihood of conclusive results before the experiment
            duration
          </Trans>
        </p>
        <Separator size="4" my="3" />
        {content}
      </div>
    </div>
  );
}

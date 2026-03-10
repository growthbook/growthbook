import {
  getHealthSettings,
  getSafeRolloutDaysLeft,
  getSafeRolloutResultStatus,
} from "shared/enterprise";

import { SafeRolloutRule } from "shared/validators";
import HelperText from "@/ui/HelperText";
import { useUser } from "@/services/UserContext";
import { useSafeRolloutSnapshot } from "@/components/SafeRollout/SnapshotProvider";

const DecisionHelpText = ({ rule }: { rule: SafeRolloutRule }) => {
  const { safeRollout, snapshot: snapshotWithResults } =
    useSafeRolloutSnapshot();

  const { hasCommercialFeature, organization } = useUser();
  const settings = organization?.settings;

  const numberFormatter = Intl.NumberFormat();
  const percentFormatter = Intl.NumberFormat(undefined, {
    style: "percent",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  if (!safeRollout || !safeRollout.startedAt || rule.enabled === false) {
    return null;
  }

  // Only use the snapshot data when looking at a live revision (or at least one with the same status as the live revision)
  const useSnapshotData = rule.status === safeRollout.status;

  const daysLeft = getSafeRolloutDaysLeft({
    safeRollout,
    snapshotWithResults,
  });

  const decisionStatus = getSafeRolloutResultStatus({
    safeRollout,
    healthSettings: getHealthSettings(
      settings,
      hasCommercialFeature("decision-framework"),
    ),
    daysLeft,
  });

  // If the safe rollout has been rolled back or released, explain that the safe rollout is
  // acting as a temporary rollout with the control or variation value
  if (rule.status === "rolled-back") {
    return (
      <HelperText status="info" mb="3">
        All users will receive the control value. If this is no longer needed,
        you can disable or delete this rule.
      </HelperText>
    );
  } else if (rule.status === "released") {
    return (
      <HelperText status="info" mb="3">
        All users will receive the rollout value. If this is no longer needed,
        you can disable or delete this rule.
      </HelperText>
    );
  }

  // If there's no decision, we can't provide more info in the help text
  if (!useSnapshotData || !decisionStatus) return null;

  // Snapshot never ran
  if (decisionStatus.status === "no-data" && !snapshotWithResults) {
    return (
      <HelperText status="warning" mb="3">
        Your safe rollout is over 24 hours old but has never updated. Please
        check your experiment update schedule or manually run an update below.
      </HelperText>
    );
  }
  // Snapshot has run but no data has come in
  else if (decisionStatus.status === "no-data" && snapshotWithResults) {
    return (
      <HelperText status="warning" mb="3">
        Your safe rollout has been running for over 24 hours and no traffic has
        come in. Check your implementation and ensure that the tracking callback
        is firing as expected.
      </HelperText>
    );
  } else if (decisionStatus.status === "unhealthy") {
    const messages: string[] = [];

    if (decisionStatus.unhealthyData.srm) {
      messages.push(
        "SRM Warning - Traffic is imbalanced and the Safe Rollout should be reverted.",
      );
    }
    if (decisionStatus.unhealthyData.multipleExposures) {
      messages.push(
        `Multiple Exposures Warning - ${numberFormatter.format(
          decisionStatus.unhealthyData.multipleExposures.multipleExposedUsers,
        )} users (${percentFormatter.format(
          decisionStatus.unhealthyData.multipleExposures.rawDecimal,
        )}) saw multiple variations and were automatically removed from results.`,
      );
    }

    if (!messages.length) {
      return null;
    }

    return (
      <HelperText status="warning" mb="3">
        {messages.join(" ")}
      </HelperText>
    );
  } else if (decisionStatus.status === "rollback-now") {
    return (
      <HelperText status="error" mb="3">
        Guardrails are failing and the Safe Rollout should be reverted.
      </HelperText>
    );
  } else if (decisionStatus.status === "ship-now") {
    return (
      <HelperText status="success" mb="3">
        The Safe Rollout has finished and no guardrails are failing. Ship Now.
      </HelperText>
    );
  } else {
    // It's running normally, the badge already shows "X days left", so there's nothing to add in the help text
    return null;
  }
};

export default DecisionHelpText;

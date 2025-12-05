import {
  getHealthSettings,
  getSafeRolloutDaysLeft,
  getSafeRolloutResultStatus,
} from "shared/enterprise";

import { SafeRolloutRule } from "back-end/src/validators/features";
import { useUser } from "@/services/UserContext";
import { useSafeRolloutSnapshot } from "@/components/SafeRollout/SnapshotProvider";
import Badge from "@/ui/Badge";

const SafeRolloutStatusBadge = ({ rule }: { rule: SafeRolloutRule }) => {
  const { safeRollout, snapshot: snapshotWithResults } =
    useSafeRolloutSnapshot();

  const { hasCommercialFeature, organization } = useUser();
  const settings = organization?.settings;

  if (!safeRollout || !safeRollout.startedAt || rule.enabled === false) {
    return null;
  }

  // If we're looking at a non-live revision, don't rely on snapshot data
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

  let color: "violet" | "green" | "red" | "amber" = "violet";
  let label = "";

  if (rule.status === "rolled-back") {
    color = "red";
    label = "Reverted";
  } else if (rule.status === "released") {
    color = "green";
    label = "Released";
  } else if (!useSnapshotData) {
    color = "violet";
    label = "Running";
  } else if (decisionStatus?.status === "no-data") {
    color = "amber";
    label = "No Data";
  } else if (decisionStatus?.status === "unhealthy") {
    color = "amber";
    label = "Unhealthy";
  } else if (decisionStatus?.status === "rollback-now") {
    color = "red";
    label = "Guardrails Failing";
  } else if (decisionStatus?.status === "ship-now") {
    color = "green";
    label = "Ready to ship";
  } else {
    color = "violet";
    label = `${Math.ceil(daysLeft).toFixed(0)} days left`;
  }

  if (!label) return null;
  return <Badge color={color} variant="soft" label={label} radius="full" />;
};

export default SafeRolloutStatusBadge;

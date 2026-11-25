import {
  getHealthSettings,
  getSafeRolloutDaysLeft,
  getSafeRolloutResultStatus,
} from "shared/enterprise";

import { SafeRolloutRule } from "shared/validators";
import { useLingui } from "@lingui/react/macro";
import { useUser } from "@/services/UserContext";
import { useSafeRolloutSnapshot } from "@/components/SafeRollout/SnapshotProvider";
import Badge from "@/ui/Badge";

const SafeRolloutStatusBadge = ({ rule }: { rule: SafeRolloutRule }) => {
  const { t } = useLingui();
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
    label = t`Reverted`;
  } else if (rule.status === "released") {
    color = "green";
    label = t`Released`;
  } else if (!useSnapshotData) {
    color = "violet";
    label = t`Running`;
  } else if (decisionStatus?.status === "no-data") {
    color = "amber";
    label = t`No Data`;
  } else if (decisionStatus?.status === "unhealthy") {
    color = "amber";
    label = t`Unhealthy`;
  } else if (decisionStatus?.status === "rollback-now") {
    color = "red";
    label = t`Guardrails Failing`;
  } else if (decisionStatus?.status === "data-incomplete") {
    color = "amber";
    label = t`Data incomplete`;
  } else if (decisionStatus?.status === "ship-now") {
    color = "green";
    label = t`Ready to ship`;
  } else {
    color = "violet";
    const daysLeftText = Math.ceil(daysLeft).toFixed(0);
    label = t`${daysLeftText} days left`;
  }

  if (!label) return null;
  return <Badge color={color} variant="soft" label={label} radius="full" />;
};

export default SafeRolloutStatusBadge;

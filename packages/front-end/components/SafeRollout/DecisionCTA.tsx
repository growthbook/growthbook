import {
  getHealthSettings,
  getSafeRolloutDaysLeft,
  getSafeRolloutResultStatus,
} from "shared/enterprise";

import { SafeRolloutRule } from "shared/validators";
import Button, { Color, Variant } from "@/ui/Button";
import { useUser } from "@/services/UserContext";
import { useSafeRolloutSnapshot } from "@/components/SafeRollout/SnapshotProvider";

const DecisionCTA = ({
  openStatusModal,
  rule,
}: {
  openStatusModal: () => void;
  rule: SafeRolloutRule;
}) => {
  const { safeRollout, snapshot: snapshotWithResults } =
    useSafeRolloutSnapshot();

  const { hasCommercialFeature, organization } = useUser();
  const settings = organization?.settings;

  if (!safeRollout || !safeRollout.startedAt || rule.enabled === false) {
    return null;
  }

  // Don't show a CTA when looking at a non-live revision
  if (rule.status !== safeRollout.status) {
    return null;
  }

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

  // Already finished, no CTA
  if (safeRollout.status === "rolled-back") {
    return null;
  } else if (safeRollout.status === "released") {
    return null;
  }

  let buttonCopy = "Stop Early";
  let variant: Variant = "soft";
  let color: Color = "violet";

  if (
    decisionStatus?.status === "unhealthy" ||
    decisionStatus?.status === "rollback-now"
  ) {
    buttonCopy = "Revert Now";
    variant = "solid";
    color = "red";
  } else if (decisionStatus?.status === "ship-now") {
    buttonCopy = "Ship Now";
    variant = "solid";
  }

  return (
    <Button
      type="button"
      onClick={openStatusModal}
      variant={variant}
      size="sm"
      color={color}
      style={{ marginTop: -4 }}
      ml="2"
    >
      {buttonCopy}
    </Button>
  );
};

export default DecisionCTA;

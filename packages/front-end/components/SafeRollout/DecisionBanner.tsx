import {
  getHealthSettings,
  getSafeRolloutDaysLeft,
  getSafeRolloutResultStatus,
} from "shared/enterprise";

import { useUser } from "@/services/UserContext";
import { useSafeRolloutSnapshot } from "@/components/SafeRollout/SnapshotProvider";
import Callout from "../Radix/Callout";

const DecisionBanner = ({
  openStatusModal,
}: {
  openStatusModal: () => void;
}) => {
  const {
    safeRollout,
    snapshot: snapshotWithResults,
  } = useSafeRolloutSnapshot();

  const { hasCommercialFeature, organization } = useUser();
  const settings = organization?.settings;

  const numberFormatter = Intl.NumberFormat();
  const percentFormatter = Intl.NumberFormat(undefined, {
    style: "percent",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  if (!safeRollout) {
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
      hasCommercialFeature("decision-framework")
    ),
    daysLeft,
  });

  // TODO: Add state that checks if safe rollout status is not the same a rule status
  // to indicate that

  // If the safe rollout has been rolled back or released, explain that the safe rollout is
  // acting as a temporary rollout with the control or variation value
  if (safeRollout.status === "rolled-back") {
    return (
      <Callout status="info">
        This Safe Rollout is rolled back and a{" "}
        <strong>Temporary Rollout</strong> is enabled. All users in the Safe
        Rollout will receive the control value. If no longer needed, you can
        disable or delete the safe rollout rule.
      </Callout>
    );
  } else if (safeRollout.status === "released") {
    return (
      <Callout status="info">
        This Safe Rollout is rolled out and a <strong>Temporary Rollout</strong>{" "}
        is enabled. All users in the Safe Rollout will receive the variation
        value. If no longer needed, you can disable or delete the safe rollout
        rule.
      </Callout>
    );
  }

  // failingGuardrails comes from the analysis summary for now, but we could return it in the above
  if (decisionStatus?.status === "unhealthy") {
    return (
      <Callout status="warning" my="4">
        {decisionStatus.unhealthyData.srm && (
          <p>
            SRM Warning. Traffic is imbalanced and the rollout should be
            stopped.
          </p>
        )}
        {decisionStatus.unhealthyData.multipleExposures && (
          <p>
            <strong>Multiple Exposures Warning</strong>.{" "}
            {numberFormatter.format(
              decisionStatus.unhealthyData.multipleExposures
                .multipleExposedUsers
            )}{" "}
            users (
            {percentFormatter.format(
              decisionStatus.unhealthyData.multipleExposures.rawDecimal
            )}
            ) saw multiple variations and were automatically removed from
            results.
          </p>
        )}
        <a
          role="button"
          className="link"
          onClick={(e) => {
            e.preventDefault();
            openStatusModal();
          }}
        >
          Revert Now
        </a>
      </Callout>
    );
  } else if (daysLeft <= 0) {
    return (
      <Callout status="success">
        Safe rollout complete and no guardrails failing{" "}
        <a
          role="button"
          className="link"
          onClick={(e) => {
            e.preventDefault();
            openStatusModal();
          }}
        >
          Ship Now
        </a>
      </Callout>
    );
  } else {
    return (
      <Callout status="info">
        {daysLeft} days left{" "}
        <a
          role="button"
          className="link"
          onClick={(e) => {
            e.preventDefault();
            openStatusModal();
          }}
        >
          Stop Early
        </a>
      </Callout>
    );
  }
};

export default DecisionBanner;

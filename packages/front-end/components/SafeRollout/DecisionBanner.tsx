import {
  getHealthSettings,
  getSafeRolloutDaysLeft,
  getSafeRolloutResultStatus,
} from "shared/enterprise";

import { Flex } from "@radix-ui/themes";
import { SafeRolloutRule } from "back-end/src/validators/features";
import Button from "@/components/Radix/Button";
import Callout from "@/components/Radix/Callout";
import { useUser } from "@/services/UserContext";
import { useSafeRolloutSnapshot } from "@/components/SafeRollout/SnapshotProvider";

const DecisionBanner = ({
  openStatusModal,
  rule,
}: {
  openStatusModal: () => void;
  rule: SafeRolloutRule;
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

  const safeRolloutDraftStatusChangeCopy =
    rule.status !== safeRollout.status
      ? "The safe rollout will not stop running until the revision is published and the status is updated."
      : "";

  // If the safe rollout has been rolled back or released, explain that the safe rollout is
  // acting as a temporary rollout with the control or variation value
  if (safeRollout.status === "rolled-back" && rule.enabled !== false) {
    return (
      <Callout status="info">
        This Safe Rollout is rolled back and a{" "}
        <strong>Temporary Rollout</strong> is enabled. All users in the Safe
        Rollout will receive the control value. If no longer needed, you can
        disable or delete the safe rollout rule.
      </Callout>
    );
  } else if (safeRollout.status === "released" && rule.enabled !== false) {
    return (
      <Callout status="info">
        This Safe Rollout is rolled out and a <strong>Temporary Rollout</strong>{" "}
        is enabled. All users in the Safe Rollout will receive the variation
        value. If no longer needed, you can disable or delete the safe rollout
        rule.
      </Callout>
    );
  }

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
        {safeRolloutDraftStatusChangeCopy && (
          <p className="mt-2 mb-0">
            <strong>{safeRolloutDraftStatusChangeCopy}</strong>
          </p>
        )}
      </Callout>
    );
  } else if (decisionStatus?.status === "rollback-now") {
    return (
      <Callout status="error">
        Guardrail(s) are failing.
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
  } else if (decisionStatus?.status === "ship-now") {
    return (
      <Callout status="success">
        Safe rollout complete and no guardrails failing.{" "}
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
        {safeRolloutDraftStatusChangeCopy && (
          <p className="mt-2 mb-0">
            <strong>{safeRolloutDraftStatusChangeCopy}</strong>
          </p>
        )}
      </Callout>
    );
  } else {
    return (
      <Callout status="info" icon={null}>
        <Flex direction="row" align="center" justify="between" width="100%">
          {Math.ceil(daysLeft).toFixed(0)} days left.
          <Button variant="soft" onClick={openStatusModal}>
            {safeRolloutDraftStatusChangeCopy
              ? "Update Variation"
              : "Stop Early"}
          </Button>
        </Flex>
        {safeRolloutDraftStatusChangeCopy && (
          <p className="mt-2 mb-0">
            <strong>{safeRolloutDraftStatusChangeCopy}</strong>
          </p>
        )}
      </Callout>
    );
  }
};

export default DecisionBanner;

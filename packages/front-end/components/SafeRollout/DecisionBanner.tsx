// import {
//   getHealthSettings,
//   getSafeRolloutResultStatus,
// } from "shared/src/enterprise/decision-criteria";
import { getSafeRolloutDaysLeft } from "shared/enterprise";
import { useSafeRolloutSnapshot } from "@/components/SafeRollout/SnapshotProvider";
// import { useUser } from "@/services/UserContext";
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
  // const { hasCommercialFeature } = useUser();
  // const { organization } = useUser();
  // const settings = organization?.settings;
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

  // const decisionStatus = getSafeRolloutResultStatus({
  //   safeRollout,
  //   healthSettings: getHealthSettings(
  //     settings,
  //     hasCommercialFeature("decision-framework")
  //   ),
  //   daysLeft,
  // });
  const decisionStatus = {
    status: "healthy",
    unhealthyData: {
      srm: false,
      multipleExposures: {
        rawDecimal: 0,
        multipleExposedUsers: 0,
      },
    },
  }; // faked data for now until we fix the decision criteria type issue
  // failingGuardrails comes from the analysis summary for now, but we could return it in the above
  if (decisionStatus?.status === "unhealthy") {
    return (
      <Callout status="error" my="4">
        {decisionStatus.unhealthyData.srm && <p>SRM is failing. Revert now.</p>}
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
            results. Check for bugs in your implementation, event tracking, or
            data pipeline.
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
        {daysLeft} days left in safe rollout{" "}
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

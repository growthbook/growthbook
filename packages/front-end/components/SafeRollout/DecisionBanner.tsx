import { addDays, differenceInDays } from "date-fns";
import { getMetricResultStatus } from "shared/experiments";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import useConfidenceLevels from "@/hooks/useConfidenceLevels";
import usePValueThreshold from "@/hooks/usePValueThreshold";
import { useSafeRolloutSnapshot } from "@/components/SafeRollout/SnapshotProvider";
import { useUser } from "@/services/UserContext";
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
  const { metricDefaults } = useOrganizationMetricDefaults();
  const { hasCommercialFeature } = useUser();
  const { organization } = useUser();
  const settings = organization?.settings;

  const { ciUpper, ciLower } = useConfidenceLevels();
  const pValueThreshold = usePValueThreshold();

  if (!safeRollout) {
    return null;
  }

  // Use latest snapshot date and safe rollout start date plus maxDurationDays to determine days left
  const startDate = safeRollout?.startedAt
    ? new Date(safeRollout.startedAt)
    : new Date();
  const endDate = addDays(
    new Date(startDate.getTime()),
    safeRollout.maxDurationDays
  );
  const latestSnapshotDate = snapshotWithResults?.runStarted
    ? new Date(snapshotWithResults?.runStarted)
    : null;
  const daysLeft = latestSnapshotDate
    ? differenceInDays(endDate, latestSnapshotDate)
    : safeRollout.maxDurationDays;

  // const decisionStatus = getSafeRolloutResultStatus({
  //   safeRollout,
  //   healthSettings: getHealthSettings(
  //     settings,
  //     hasCommercialFeature("decision-framework")
  //   ),
  //   daysLeft,
  // });

  // failingGuardrails comes from the analysis summary for now, but we could return it in the above
  const failingGuardrails = ["X", "Y", "Z"]; // Mocked for demonstration
  const decisionStatus = { status: "rollback-now" }; // Mocked decision status for demonstration
  if (decisionStatus?.status === "rollback-now") {
    return (
      <Callout status="error" my="4">
        Guardrail(s) {failingGuardrails.join(", ")} are failing.{" "}
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

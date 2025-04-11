import {
  DEFAULT_DECISION_CRITERIAS,
  getDecisionFrameworkStatus,
} from "shared/enterprise";
import { addDays, differenceInDays } from "date-fns";
import { getMetricResultStatus } from "shared/experiments";
import { useOrganizationMetricDefaults } from "@/hooks/useOrganizationMetricDefaults";
import useConfidenceLevels from "@/hooks/useConfidenceLevels";
import usePValueThreshold from "@/hooks/usePValueThreshold";
import Callout from "../Radix/Callout";
import { useSnapshot } from "./SnapshotProvider";

const DecisionBanner = ({ openStatusModal }) => {
  const { safeRollout, snapshot: snapshotWithResults } = useSnapshot();
  const { metricDefaults } = useOrganizationMetricDefaults();

  const { ciUpper, ciLower } = useConfidenceLevels();
  const pValueThreshold = usePValueThreshold();

  if (!safeRollout) {
    return null;
  }

  // Use latest snapshot date and safe rollout start date plus maxDurationDays to determine days left
  const startDate = new Date(safeRollout.startedAt);
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

  // Get all metrics from the latest snapshot with results and determine whether or not they're failing
  // baseline and stats should come from the snapshot
  //   const {
  //     resultsStatus,
  //     directionalStatus,
  //     shouldHighlight,
  //   } = getMetricResultStatus({
  //     metric,
  //     metricDefaults,
  //     baseline,
  //     stats,
  //     ciLower,
  //     ciUpper,
  //     pValueThreshold,
  //     statsEngine: "frequentist",
  //   });
  const failingGuardrails = ["X", "Y", "Z"]; // Mocked for demonstration

  // Uncomment when analysisSummary is added to safe rollout
  //   const resultsStatus = safeRollout.analysisSummary?.resultsStatus;
  //   const [, doNoHarm] = DEFAULT_DECISION_CRITERIAS;
  //   const decisionStatus = getDecisionFrameworkStatus({
  //     resultsStatus,
  //     decisionCriteria: doNoHarm,
  //     goalMetrics: [],
  //     guardrailMetrics: safeRollout.guardrailMetrics,
  //   });

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

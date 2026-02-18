import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import CompareAuditEventsModal from "@/components/Audit/CompareAuditEventsModal";
import { AuditDiffConfig } from "@/components/Audit/types";

/**
 * Audit events that represent meaningful model-level changes to an experiment.
 * Non-model events (refresh, screenshot operations) are excluded.
 */
export const INCLUDED_EXPERIMENT_EVENTS = [
  "experiment.create",
  "experiment.update",
  "experiment.status",
  "experiment.start",
  "experiment.stop",
  "experiment.archive",
  "experiment.unarchive",
  "experiment.phase",
  "experiment.phase.delete",
] as const;

export const EXPERIMENT_EVENT_LABELS: Record<string, string> = {
  "experiment.create": "Created",
  "experiment.update": "Updated",
  "experiment.status": "Status changed",
  "experiment.start": "Started",
  "experiment.stop": "Stopped",
  "experiment.archive": "Archived",
  "experiment.unarchive": "Unarchived",
  "experiment.phase": "Phase updated",
  "experiment.phase.delete": "Phase deleted",
};

const EXPERIMENT_DIFF_CONFIG: AuditDiffConfig<ExperimentInterfaceStringDates> =
  {
    entityType: "experiment",
    includedEvents: [...INCLUDED_EXPERIMENT_EVENTS],
    defaultGroupBy: "minute",
    sections: [
      {
        // coverage, condition, savedGroups, prerequisites, namespace, seed,
        // variationWeights — the fields that affect SDK bucketing/targeting.
        // A custom render will surface only these sub-fields once implemented.
        label: "User targeting",
        keys: ["phases"],
      },
      {
        // dateStarted, dateEnded, name, reason, lookbackStartDate, banditEvents
        label: "Phase info",
        keys: ["phases"],
      },
      {
        label: "Variations",
        keys: ["variations"],
      },
      {
        label: "Metrics",
        keys: [
          "goalMetrics",
          "secondaryMetrics",
          "guardrailMetrics",
          "activationMetric",
          "metricOverrides",
          "decisionFrameworkSettings",
        ],
      },
      {
        label: "Analysis Settings",
        keys: [
          "hashAttribute",
          "fallbackAttribute",
          "hashVersion",
          "segment",
          "queryFilter",
          "skipPartialData",
          "exposureQueryId",
          "datasource",
          "trackingKey",
          "statsEngine",
          "regressionAdjustmentEnabled",
          "postStratificationEnabled",
          "sequentialTestingEnabled",
          "sequentialTestingTuningParameter",
          "attributionModel",
          "customMetricSlices",
        ],
      },
      {
        label: "Settings",
        keys: [
          "name",
          "description",
          "hypothesis",
          "tags",
          "project",
          "owner",
          "type",
          "shareLevel",
          "templateId",
        ],
      },
    ],
  };

export interface CompareExperimentEventsModalProps {
  experiment: ExperimentInterfaceStringDates;
  onClose: () => void;
}

export default function CompareExperimentEventsModal({
  experiment,
  onClose,
}: CompareExperimentEventsModalProps) {
  return (
    <CompareAuditEventsModal<ExperimentInterfaceStringDates>
      entityId={experiment.id}
      config={EXPERIMENT_DIFF_CONFIG}
      eventLabels={EXPERIMENT_EVENT_LABELS}
      onClose={onClose}
    />
  );
}

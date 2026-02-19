import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import CompareAuditEventsModal from "@/components/Audit/CompareAuditEventsModal";
import { AuditDiffConfig } from "@/components/Audit/types";

/**
 * Audit events that represent meaningful model-level changes to an experiment.
 * Non-model events are either in labelOnlyEvents (shown as info labels) or excluded entirely.
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
    labelOnlyEvents: [
      {
        event: "experiment.refresh",
        getLabel: () => "Refreshed analysis",
      },
    ],
    defaultGroupBy: "minute",
    entityLabel: "Experiment",
    normalizeSnapshot: (snapshot) => {
      // Deep-clone and parse any JSON string `condition` fields so the diff
      // viewer shows structured objects rather than escaped string blobs.
      const parseConditions = (obj: unknown): unknown => {
        if (Array.isArray(obj)) return obj.map(parseConditions);
        if (obj !== null && typeof obj === "object") {
          const result: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
            if (k === "condition" && typeof v === "string") {
              try {
                result[k] = JSON.parse(v);
              } catch {
                result[k] = v;
              }
            } else {
              result[k] = parseConditions(v);
            }
          }
          return result;
        }
        return obj;
      };
      return parseConditions(snapshot) as ExperimentInterfaceStringDates;
    },
    updateEventNames: ["experiment.update", "experiment.phase"],
    overrideEventLabel: (entry) => {
      if (entry.event === "experiment.status") {
        const status = entry.postSnapshot?.status;
        return status ? `Status changed (${status})` : null;
      }
      if (entry.event === "experiment.phase.delete") {
        const pre = entry.preSnapshot?.phases ?? [];
        const post = entry.postSnapshot?.phases ?? [];
        let idx = pre.length - 1;
        for (let i = 0; i < pre.length; i++) {
          if (i >= post.length || pre[i].dateStarted !== post[i].dateStarted) {
            idx = i;
            break;
          }
        }
        return `Phase deleted (${idx})`;
      }
      return null;
    },
    sections: [
      {
        label: "User targeting",
        keys: ["phases"],
        pickSubKeys: [
          "coverage",
          "condition",
          "savedGroups",
          "prerequisites",
          "namespace",
          "seed",
          "variationWeights",
        ],
        stripSubKeys: ["banditEvents"],
        stripSubKeysLabel: "Phases: other changes",
      },
      {
        label: "User targeting",
        keys: [
          "excludeFromPayload",
          "bucketVersion",
          "minBucketVersion",
          "disableStickyBucketing",
        ],
      },
      {
        label: "Phase info",
        keys: ["phases"],
        pickSubKeys: [
          "dateStarted",
          "dateEnded",
          "name",
          "reason",
          "lookbackStartDate",
        ],
        stripSubKeys: ["banditEvents"],
        stripSubKeysLabel: "Phases: other changes",
      },
      {
        label: "Variations",
        keys: ["variations"],
      },
      {
        label: "Analysis settings",
        keys: [
          "goalMetrics",
          "secondaryMetrics",
          "guardrailMetrics",
          "activationMetric",
          "metricOverrides",
          "decisionFrameworkSettings",
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
          "banditBurnInUnit",
          "banditBurnInValue",
          "banditScheduleUnit",
          "banditScheduleValue",
        ],
      },
      {
        label: "Metadata",
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

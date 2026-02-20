import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import CompareAuditEventsModal from "@/components/AuditHistoryExplorer/CompareAuditEventsModal";
import { AuditDiffConfig, CoarsenedAuditEntry } from "@/components/AuditHistoryExplorer/types";
import {
  renderUserTargetingPhases,
  renderUserTargetingTopLevel,
  renderPhaseInfo,
  renderVariations,
  renderAnalysisSettings,
  renderMetadata,
} from "./ExperimentDiffRenders";

type ExperimentEventDef = {
  label: string;
  /** Produces a diffable snapshot; shown as a selectable entry in the list. */
  comparable?: boolean;
  /** Always rendered in the timeline, never collapsed into a noise group. */
  alwaysVisible?: boolean;
  /** Dynamic label override — return a string or null to fall through to `label`. */
  getLabel?: (
    entry: CoarsenedAuditEntry<ExperimentInterfaceStringDates>,
  ) => string | null;
};

/** All known experiment audit events. */
export const EXPERIMENT_EVENTS: Record<string, ExperimentEventDef> = {
  "experiment.create": { label: "Created", comparable: true },
  "experiment.update": { label: "Updated", comparable: true },
  "experiment.status": {
    label: "Status changed",
    comparable: true,
    getLabel: (e) => {
      const s = e.postSnapshot?.status;
      return s ? `Status changed (${s})` : null;
    },
  },
  "experiment.start": { label: "Started", comparable: true },
  "experiment.stop": { label: "Stopped", comparable: true },
  "experiment.results": { label: "Results recorded", comparable: true },
  "experiment.archive": {
    label: "Archived",
    comparable: true,
    alwaysVisible: true,
  },
  "experiment.unarchive": {
    label: "Unarchived",
    comparable: true,
    alwaysVisible: true,
  },
  "experiment.phase": { label: "Phase updated", comparable: true },
  "experiment.phase.delete": {
    label: "Phase deleted",
    comparable: true,
    getLabel: (e) => {
      const pre = e.preSnapshot?.phases ?? [];
      const post = e.postSnapshot?.phases ?? [];
      let idx = pre.length - 1;
      for (let i = 0; i < pre.length; i++) {
        if (i >= post.length || pre[i].dateStarted !== post[i].dateStarted) {
          idx = i;
          break;
        }
      }
      return `Phase deleted (${idx})`;
    },
  },
  "experiment.delete": { label: "Deleted", alwaysVisible: true },
  "experiment.refresh": { label: "Refreshed analysis" },
  "experiment.analysis": { label: "Custom report analysis run" },
  "experiment.launchChecklist.updated": { label: "Launch checklist updated" },
  "experiment.screenshot.create": { label: "Screenshot added" },
  "experiment.screenshot.delete": { label: "Screenshot removed" },
};

const EXPERIMENT_DIFF_CONFIG: AuditDiffConfig<ExperimentInterfaceStringDates> =
  {
    entityType: "experiment",
    includedEvents: Object.entries(EXPERIMENT_EVENTS)
      .filter(([, v]) => v.comparable)
      .map(([k]) => k),
    labelOnlyEvents: Object.entries(EXPERIMENT_EVENTS)
      .filter(([, v]) => !v.comparable)
      .map(([event, v]) => ({
        event,
        getLabel: () => v.label,
        alwaysVisible: v.alwaysVisible,
      })),
    alwaysVisibleEvents: Object.entries(EXPERIMENT_EVENTS)
      .filter(([, v]) => v.comparable && v.alwaysVisible)
      .map(([k]) => k),
    catchUnknownEventsAsLabels: true,
    defaultGroupBy: "minute",
    entityLabel: "Experiment",
    defaultHiddenSections: ["other changes"],
    hiddenLabelSections: ["other changes", "Phase info"],
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
    overrideEventLabel: (entry) =>
      EXPERIMENT_EVENTS[entry.event]?.getLabel?.(entry) ?? null,
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
        render: renderUserTargetingPhases,
      },
      {
        label: "User targeting",
        keys: [
          "excludeFromPayload",
          "bucketVersion",
          "minBucketVersion",
          "disableStickyBucketing",
        ],
        render: renderUserTargetingTopLevel,
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
        render: renderPhaseInfo,
      },
      {
        label: "Variations",
        keys: ["variations"],
        render: renderVariations,
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
        render: renderAnalysisSettings,
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
        render: renderMetadata,
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
      eventLabels={Object.fromEntries(
        Object.entries(EXPERIMENT_EVENTS).map(([k, v]) => [k, v.label]),
      )}
      onClose={onClose}
    />
  );
}

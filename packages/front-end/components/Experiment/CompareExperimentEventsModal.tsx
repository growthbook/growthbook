import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
} from "shared/types/experiment";
import AuditHistoryExplorerModal from "@/components/AuditHistoryExplorer/AuditHistoryExplorerModal";
import {
  AuditDiffConfig,
  CoarsenedAuditEntry,
} from "@/components/AuditHistoryExplorer/types";
import {
  renderUserTargetingPhases,
  renderUserTargetingTopLevel,
  renderPhaseInfo,
  renderAnalysisSettings,
  renderMetadata,
  getExperimentTargetingBadges,
  getExperimentPhaseInfoBadges,
  getExperimentVariationsBadges,
  getExperimentAnalysisBadges,
  getExperimentMetadataBadges,
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
  "experiment.launchChecklist.updated": { label: "Launch checklist updated" },
  "experiment.screenshot.create": { label: "Screenshot added" },
  "experiment.screenshot.delete": { label: "Screenshot removed" },
};

const EXPERIMENT_EVENT_LABELS: Record<string, string> = Object.fromEntries(
  Object.entries(EXPERIMENT_EVENTS).map(([k, v]) => [k, v.label]),
);

type ExperimentSectionId =
  | "targeting-phases"
  | "targeting-top-level"
  | "phase-info"
  | "variations"
  | "analysis"
  | "metadata";

// false = intentionally unclaimed: key is omitted from all named sections and
// lands in the "other changes" overflow section (raw JSON diff only, no rendered
// summary or badges). This is the desired behavior for noise/internal fields.
type SectionAssignment = ExperimentSectionId | ExperimentSectionId[] | false;

// Exhaustiveness-checked map of every ExperimentPhaseStringDates field to its
// section. Adding a new field to ExperimentPhaseStringDates will produce a TS
// error here until it is explicitly assigned — same pattern as
// EXPERIMENT_SECTION_KEYS for top-level fields.
//
// "phases" is intentionally claimed by two sections:
//   - "targeting-phases" uses pickSubKeys (allowlist) so only its exact fields
//     appear. A plain phases entry without pickSubKeys would produce an
//     unintelligible raw diff of the entire phases array, so never add one.
//   - "phase-info" uses stripSubKeys (denylist): it strips targeting fields and
//     companion fields, then passes everything else through. This means any new
//     phase field not yet assigned here will automatically appear in the Phase
//     info raw JSON diff rather than being silently dropped.
type PhaseKeyAssignment =
  | "targeting-phases"
  | "phase-info"
  | "variations"
  | false;
const PHASE_SUB_KEYS: Record<
  keyof ExperimentPhaseStringDates,
  PhaseKeyAssignment
> = {
  // "User targeting" section (allowlist via pickSubKeys)
  coverage: "targeting-phases",
  condition: "targeting-phases",
  savedGroups: "targeting-phases",
  prerequisites: "targeting-phases",
  namespace: "targeting-phases",
  seed: "targeting-phases",
  variationWeights: "targeting-phases",
  // "Phase info" section (denylist via stripSubKeys — see comment above)
  dateStarted: "phase-info",
  dateEnded: "phase-info",
  name: "phase-info",
  reason: "phase-info",
  lookbackStartDate: "phase-info",
  // false = excluded from rendered sections; shown only in the companion raw diff
  banditEvents: false,
  // shown separately in the variations section
  variations: "variations",
};
function phaseKeys(section: "targeting-phases" | "phase-info"): string[] {
  return Object.entries(PHASE_SUB_KEYS)
    .filter(([, v]) => v === section)
    .map(([k]) => k);
}
// Keys stripped from the companion diff (banditEvents etc.)
const phaseStripSubKeys = Object.entries(PHASE_SUB_KEYS)
  .filter(([, v]) => v === false)
  .map(([k]) => k);
// "Phase info" strips targeting fields and companion fields so that everything
// else (including any future unassigned fields) falls through to its raw diff.
const phaseInfoStripSubKeys = [
  ...phaseKeys("targeting-phases"),
  ...phaseStripSubKeys,
];

const EXPERIMENT_SECTION_KEYS: Record<
  keyof ExperimentInterfaceStringDates,
  SectionAssignment
> = {
  // phases is split across two sections; see PHASE_SUB_KEYS above for the
  // field-level breakdown and the rationale for why pickSubKeys is required.
  phases: ["targeting-phases", "phase-info"],

  // — User targeting (top-level) —
  excludeFromPayload: "targeting-top-level",
  bucketVersion: "targeting-top-level",
  minBucketVersion: "targeting-top-level",
  disableStickyBucketing: "targeting-top-level",

  // — Analysis settings —
  goalMetrics: "analysis",
  secondaryMetrics: "analysis",
  guardrailMetrics: "analysis",
  activationMetric: "analysis",
  metricOverrides: "analysis",
  decisionFrameworkSettings: "analysis",
  hashAttribute: "analysis",
  fallbackAttribute: "analysis",
  hashVersion: "analysis",
  segment: "analysis",
  queryFilter: "analysis",
  skipPartialData: "analysis",
  exposureQueryId: "analysis",
  datasource: "analysis",
  trackingKey: "analysis",
  statsEngine: "analysis",
  regressionAdjustmentEnabled: "analysis",
  postStratificationEnabled: "analysis",
  sequentialTestingEnabled: "analysis",
  sequentialTestingTuningParameter: "analysis",
  attributionModel: "analysis",
  customMetricSlices: "analysis",
  banditBurnInUnit: "analysis",
  banditBurnInValue: "analysis",
  banditScheduleUnit: "analysis",
  banditScheduleValue: "analysis",
  lookbackOverride: "analysis",

  // — Metadata —
  name: "metadata",
  description: "metadata",
  hypothesis: "metadata",
  tags: "metadata",
  project: "metadata",
  status: "metadata",
  winner: "metadata",
  owner: "metadata",
  type: "metadata",
  shareLevel: "metadata",
  templateId: "metadata",
  customFields: "metadata",
  archived: "metadata",

  // — Intentionally excluded from diff sections —
  id: false,
  uid: false,
  organization: false,
  implementation: false,
  userIdType: false,
  pastNotifications: false,
  dateCreated: false,
  dateUpdated: false,
  autoAssign: false,
  previewURL: false,
  targetURLRegex: false,
  results: false,
  analysis: false,
  releasedVariationId: false,
  lastSnapshotAttempt: false,
  nextSnapshotAttempt: false,
  autoSnapshots: false,
  ideaSource: false,
  hasVisualChangesets: false,
  hasURLRedirects: false,
  linkedFeatures: false,
  manualLaunchChecklist: false,
  banditStage: false,
  banditStageDateStarted: false,
  analysisSummary: false,
  dismissedWarnings: false,
  holdoutId: false,
  defaultDashboardId: false,
};

function sectionKeys(
  id: ExperimentSectionId,
): (keyof ExperimentInterfaceStringDates)[] {
  return (
    Object.keys(
      EXPERIMENT_SECTION_KEYS,
    ) as (keyof ExperimentInterfaceStringDates)[]
  ).filter((k) => {
    const v = EXPERIMENT_SECTION_KEYS[k];
    return v === id || (Array.isArray(v) && v.includes(id));
  });
}

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
    ignoredEvents: ["experiment.refresh", "experiment.analysis"],
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
        keys: sectionKeys("targeting-phases"),
        pickSubKeys: phaseKeys("targeting-phases"),
        stripSubKeys: phaseStripSubKeys,
        stripSubKeysLabel: "Phases: other changes",
        render: renderUserTargetingPhases,
        getBadges: getExperimentTargetingBadges,
      },
      {
        label: "User targeting",
        keys: sectionKeys("targeting-top-level"),
        render: renderUserTargetingTopLevel,
        getBadges: getExperimentTargetingBadges,
      },
      {
        label: "Phase info",
        keys: sectionKeys("phase-info"),
        stripSubKeys: phaseInfoStripSubKeys,
        render: renderPhaseInfo,
        getBadges: getExperimentPhaseInfoBadges,
      },
      {
        label: "Variations",
        keys: sectionKeys("variations"),
        render: renderPhaseInfo,
        getBadges: getExperimentVariationsBadges,
      },
      {
        label: "Analysis settings",
        keys: sectionKeys("analysis"),
        render: renderAnalysisSettings,
        getBadges: getExperimentAnalysisBadges,
      },
      {
        label: "Metadata",
        keys: sectionKeys("metadata"),
        render: renderMetadata,
        getBadges: getExperimentMetadataBadges,
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
    <AuditHistoryExplorerModal<ExperimentInterfaceStringDates>
      entityId={experiment.id}
      entityName="Experiment"
      config={EXPERIMENT_DIFF_CONFIG}
      eventLabels={EXPERIMENT_EVENT_LABELS}
      onClose={onClose}
    />
  );
}

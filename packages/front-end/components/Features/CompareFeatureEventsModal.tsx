import { FeatureInterface } from "shared/types/feature";
import AuditHistoryExplorerModal from "@/components/AuditHistoryExplorer/AuditHistoryExplorerModal";
import { AuditDiffConfig } from "@/components/AuditHistoryExplorer/types";
import { OVERFLOW_SECTION_LABEL } from "@/components/AuditHistoryExplorer/useAuditDiff";

/** Keys whose string values are embedded JSON and should be parsed for diffing. */
const JSON_STRING_KEYS = new Set(["condition", "defaultValue", "value"]);

/**
 * Recursively walk an object and parse any string fields whose key is in
 * JSON_STRING_KEYS into structured objects so the diff viewer renders them
 * as structured diffs rather than escaped string blobs.
 */
function parseJsonStringFields(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(parseJsonStringFields);
  if (obj !== null && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (JSON_STRING_KEYS.has(k) && typeof v === "string") {
        try {
          result[k] = JSON.parse(v);
        } catch {
          result[k] = v;
        }
      } else {
        result[k] = parseJsonStringFields(v);
      }
    }
    return result;
  }
  return obj;
}

const FEATURE_DIFF_CONFIG: AuditDiffConfig<FeatureInterface> = {
  entityType: "feature",
  includedEvents: [
    "feature.create",
    "feature.update",
    "feature.publish",
    "feature.toggle",
    "feature.revert",
    "feature.archive",
  ],
  alwaysVisibleEvents: ["feature.create"],
  labelOnlyEvents: [
    {
      event: "feature.delete",
      getLabel: () => "Deleted",
      alwaysVisible: true,
    },
  ],
  catchUnknownEventsAsLabels: true,
  ignoredEvents: [],
  updateEventNames: ["feature.update", "feature.publish", "feature.toggle"],
  overrideEventLabel: (entry) => {
    const preVersion = entry.preSnapshot?.version;
    const postVersion = entry.postSnapshot?.version;
    if (postVersion !== undefined && postVersion !== preVersion) {
      return `Published version ${postVersion}`;
    }
    return null;
  },
  defaultGroupBy: "minute",
  hiddenLabelSections: [OVERFLOW_SECTION_LABEL],
  normalizeSnapshot: (snapshot) =>
    parseJsonStringFields(snapshot) as FeatureInterface,
};

export interface CompareFeatureEventsModalProps {
  feature: FeatureInterface;
  onClose: () => void;
}

export default function CompareFeatureEventsModal({
  feature,
  onClose,
}: CompareFeatureEventsModalProps) {
  return (
    <AuditHistoryExplorerModal<FeatureInterface>
      entityId={feature.id}
      entityName="Feature"
      config={FEATURE_DIFF_CONFIG}
      onClose={onClose}
    />
  );
}

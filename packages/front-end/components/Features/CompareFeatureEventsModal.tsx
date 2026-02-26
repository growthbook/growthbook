import { FeatureInterface } from "shared/types/feature";
import AuditHistoryExplorerModal from "@/components/AuditHistoryExplorer/AuditHistoryExplorerModal";
import { AuditDiffConfig } from "@/components/AuditHistoryExplorer/types";
import { OVERFLOW_SECTION_LABEL } from "@/components/AuditHistoryExplorer/useAuditDiff";
import {
  normalizeFeatureSnapshot,
  renderFeatureDefaultValueSection,
  renderFeatureRulesSection,
  getFeatureRulesBadges,
  renderFeatureMetadataSection,
  getFeatureMetadataBadges,
} from "./FeatureDiffRenders";

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
  entityLabel: "Feature",
  updateEventNames: ["feature.update", "feature.publish", "feature.toggle"],
  overrideEventLabel: (entry) => {
    // Version publish
    const preVersion = entry.preSnapshot?.version;
    const postVersion = entry.postSnapshot?.version;
    if (postVersion !== undefined && postVersion !== preVersion) {
      return `Published version ${postVersion}`;
    }
    // Toggle — find which env changed and produce "Enabled/Disabled in {env}"
    if (entry.event === "feature.toggle") {
      const preEnvs = entry.preSnapshot?.environmentSettings ?? {};
      const postEnvs = entry.postSnapshot?.environmentSettings ?? {};
      const changed = Object.keys(postEnvs).find(
        (env) => preEnvs[env]?.enabled !== postEnvs[env]?.enabled,
      );
      if (changed) {
        const nowEnabled = postEnvs[changed]?.enabled;
        return `${nowEnabled ? "Enabled" : "Disabled"} in ${changed}`;
      }
    }
    return null;
  },
  defaultGroupBy: "minute",
  hiddenLabelSections: [OVERFLOW_SECTION_LABEL],
  defaultHiddenSections: [OVERFLOW_SECTION_LABEL],
  normalizeSnapshot: normalizeFeatureSnapshot,
  sections: [
    {
      label: "Default value",
      keys: ["defaultValue"],
      render: renderFeatureDefaultValueSection,
    },
    {
      label: "Rules",
      keys: ["environmentSettings"],
      suppressCardLabel: true,
      render: renderFeatureRulesSection,
      getBadges: getFeatureRulesBadges,
    },
    {
      label: "Settings",
      keys: ["archived", "description", "owner", "project", "tags"],
      render: renderFeatureMetadataSection,
      getBadges: getFeatureMetadataBadges,
    },
  ],
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

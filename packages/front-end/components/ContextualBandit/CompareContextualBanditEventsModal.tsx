import { ContextualBanditInterface } from "shared/validators";
import AuditHistoryExplorerModal from "@/components/AuditHistoryExplorer/AuditHistoryExplorerModal";
import { AuditDiffConfig } from "@/components/AuditHistoryExplorer/types";
import { OVERFLOW_SECTION_LABEL } from "@/components/AuditHistoryExplorer/useAuditDiff";

const CONTEXTUAL_BANDIT_DIFF_CONFIG: AuditDiffConfig<ContextualBanditInterface> =
  {
    entityType: "contextualBandit",
    includedEvents: [
      "contextualBandit.create",
      "contextualBandit.update",
      "contextualBandit.start",
      "contextualBandit.stop",
    ],
    alwaysVisibleEvents: [
      "contextualBandit.create",
      "contextualBandit.start",
      "contextualBandit.stop",
    ],
    labelOnlyEvents: [
      {
        event: "contextualBandit.delete",
        getLabel: () => "Deleted",
        alwaysVisible: true,
      },
    ],
    catchUnknownEventsAsLabels: true,
    entityLabel: "Contextual Bandit",
    updateEventNames: ["contextualBandit.update"],
    defaultGroupBy: "minute",
    hiddenLabelSections: [OVERFLOW_SECTION_LABEL],
    defaultHiddenSections: [OVERFLOW_SECTION_LABEL],
    normalizeSnapshot: (snapshot) => {
      // Parse the JSON-string condition so the diff renders structurally
      // instead of as an escaped string blob.
      if (typeof snapshot.condition !== "string" || !snapshot.condition) {
        return snapshot;
      }
      try {
        return {
          ...snapshot,
          condition: JSON.parse(snapshot.condition),
        } as unknown as ContextualBanditInterface;
      } catch {
        return snapshot;
      }
    },
    sections: [
      {
        label: "Overview",
        keys: [
          "name",
          "description",
          "owner",
          "project",
          "tags",
          "archived",
          "trackingKey",
        ],
      },
      {
        label: "Variations",
        keys: ["variations"],
      },
      {
        label: "Traffic & Targeting",
        keys: [
          "coverage",
          "condition",
          "savedGroups",
          "prerequisites",
          "hashAttribute",
        ],
      },
      {
        label: "Analysis & Metrics",
        keys: [
          "datasource",
          "contextualBanditQueryId",
          "contextualAttributes",
          "decisionMetric",
          "minUsersPerLeaf",
          "maxLeaves",
          "scheduleValue",
          "scheduleUnit",
          "burnInValue",
          "burnInUnit",
          "conversionWindowValue",
          "conversionWindowUnit",
        ],
      },
      {
        label: "Status",
        keys: [
          "status",
          "dateStarted",
          "dateStopped",
          "stage",
          "stageDateStarted",
          "autoSnapshots",
        ],
      },
      {
        label: "Weights",
        keys: [
          "variationWeights",
          "currentLeafWeights",
          "banditVersion",
          "banditModelVersion",
          "seed",
        ],
      },
      {
        label: "Linked Features",
        keys: ["linkedFeatures", "pendingFeatureDrafts"],
      },
    ],
  };

export interface CompareContextualBanditEventsModalProps {
  cbId: string;
  onClose: () => void;
}

export default function CompareContextualBanditEventsModal({
  cbId,
  onClose,
}: CompareContextualBanditEventsModalProps) {
  return (
    <AuditHistoryExplorerModal<ContextualBanditInterface>
      entityId={cbId}
      entityName="Contextual Bandit"
      config={CONTEXTUAL_BANDIT_DIFF_CONFIG}
      onClose={onClose}
    />
  );
}

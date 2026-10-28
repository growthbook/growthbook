import { InterleavingInterface } from "shared/validators";
import AuditHistoryExplorerModal from "@/components/AuditHistoryExplorer/AuditHistoryExplorerModal";
import { AuditDiffConfig } from "@/components/AuditHistoryExplorer/types";
import { OVERFLOW_SECTION_LABEL } from "@/components/AuditHistoryExplorer/useAuditDiff";

const INTERLEAVING_DIFF_CONFIG: AuditDiffConfig<InterleavingInterface> = {
  entityType: "interleaving",
  includedEvents: ["interleaving.create", "interleaving.update"],
  alwaysVisibleEvents: ["interleaving.create"],
  labelOnlyEvents: [
    {
      event: "interleaving.delete",
      getLabel: () => "Deleted",
      alwaysVisible: true,
    },
  ],
  catchUnknownEventsAsLabels: true,
  entityLabel: "Interleaving Experiment",
  updateEventNames: ["interleaving.update"],
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
      } as unknown as InterleavingInterface;
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
      label: "Rankers",
      keys: ["variations", "jsonSchema"],
    },
    {
      label: "Targeting",
      keys: [
        "coverage",
        "condition",
        "savedGroups",
        "prerequisites",
        "hashAttribute",
        "seed",
      ],
    },
    {
      label: "Analysis & Metrics",
      keys: [
        "datasource",
        "interleavingExposureQueryId",
        "userIdType",
        "metrics",
      ],
    },
    {
      label: "Status",
      keys: ["status", "dateStarted", "dateStopped"],
    },
    {
      label: "Environments",
      keys: ["environmentSettings"],
    },
  ],
};

export interface CompareInterleavingEventsModalProps {
  interleavingId: string;
  onClose: () => void;
}

export default function CompareInterleavingEventsModal({
  interleavingId,
  onClose,
}: CompareInterleavingEventsModalProps) {
  return (
    <AuditHistoryExplorerModal<InterleavingInterface>
      entityId={interleavingId}
      entityName="Interleaving Experiment"
      config={INTERLEAVING_DIFF_CONFIG}
      onClose={onClose}
    />
  );
}

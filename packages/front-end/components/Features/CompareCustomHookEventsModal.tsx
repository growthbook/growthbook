import { CustomHookInterface } from "shared/validators";
import { useAuth } from "@/services/auth";
import AuditHistoryExplorerModal from "@/components/AuditHistoryExplorer/AuditHistoryExplorerModal";
import { AuditDiffConfig } from "@/components/AuditHistoryExplorer/types";
import {
  renderCustomHookSettingsSection,
  getCustomHookSettingsBadges,
  renderCustomHookCodeSection,
  getCustomHookCodeBadges,
} from "./CustomHookDiffRenders";

const CUSTOM_HOOK_DIFF_CONFIG: AuditDiffConfig<CustomHookInterface> = {
  entityType: "customHook",
  includedEvents: [
    "customHook.create",
    "customHook.update",
    "customHook.revert",
  ],
  alwaysVisibleEvents: ["customHook.create", "customHook.revert"],
  catchUnknownEventsAsLabels: true,
  entityLabel: "Custom Hook",
  updateEventNames: ["customHook.update"],
  overrideEventLabel: (entry) =>
    entry.event === "customHook.revert" ? "Reverted" : null,
  defaultGroupBy: "minute",
  singleSelect: true,
  hideFilters: true,
  contentView: {
    label: "Code",
    language: "javascript",
    get: (hook) => hook.code ?? "",
  },
  sections: [
    {
      label: "Code",
      keys: ["code"],
      suppressCardLabel: true,
      render: renderCustomHookCodeSection,
      getBadges: getCustomHookCodeBadges,
    },
    {
      label: "Settings",
      keys: [
        "name",
        "hook",
        "enabled",
        "projects",
        "entityType",
        "entityId",
        "incrementalChangesOnly",
      ],
      render: renderCustomHookSettingsSection,
      getBadges: getCustomHookSettingsBadges,
    },
  ],
};

export default function CompareCustomHookEventsModal({
  hook,
  canRevert,
  onClose,
  onRevert,
}: {
  hook: CustomHookInterface;
  canRevert: boolean;
  onClose: () => void;
  onRevert: () => void;
}) {
  const { apiCall } = useAuth();

  return (
    <AuditHistoryExplorerModal<CustomHookInterface>
      entityId={hook.id}
      entityName="Custom Hook"
      config={CUSTOM_HOOK_DIFF_CONFIG}
      onClose={onClose}
      revert={
        canRevert
          ? {
              cta: "Revert to this version",
              confirmTitle: "Revert to this version?",
              confirmBody:
                "This replaces the hook's current code and settings with this version, recorded as a new change. You can revert again to undo it.",
              onRevert: async (entry) => {
                // The last raw id in the group produced the displayed post state.
                const auditId = entry.rawIds[entry.rawIds.length - 1];
                await apiCall(`/custom-hooks/${hook.id}/revert`, {
                  method: "POST",
                  body: JSON.stringify({ auditId }),
                });
                onRevert();
                onClose();
              },
            }
          : undefined
      }
    />
  );
}

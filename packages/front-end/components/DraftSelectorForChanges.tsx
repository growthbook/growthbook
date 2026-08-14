import { ReactNode, useEffect } from "react";
import DraftSelector, { DraftMode } from "@/components/DraftSelector";

export type { DraftMode };

export default function DraftSelectorForChanges<K>({
  activeDraftKeys: allActiveDraftKeys,
  writableDraftKeys,
  selectedDraft,
  setSelectedDraft,
  mode,
  setMode,
  canAutoPublish,
  approvalRequired,
  existingDraftLabel,
  revisionDropdown,
  defaultExpanded = false,
  hideExisting = false,
  triggerPrefix = "Changes will be",
  metadataOnly = false,
  canDraft = true,
  maxDrafts = 0,
  isAdmin = false,
  allowNewDraftAtCap = false,
  capNoun = "This",
  alert,
}: {
  activeDraftKeys: K[];
  selectedDraft: K | null;
  setSelectedDraft: (v: K | null) => void;
  mode: DraftMode;
  setMode: (m: DraftMode) => void;
  canAutoPublish: boolean;
  approvalRequired: boolean;
  existingDraftLabel?: ReactNode;
  revisionDropdown?: ReactNode;
  defaultExpanded?: boolean;
  hideExisting?: boolean;
  triggerPrefix?: string;
  metadataOnly?: boolean;
  canDraft?: boolean;
  // Soft per-entity draft cap (org setting). 0 means no cap.
  maxDrafts?: number;
  isAdmin?: boolean;
  // Allow critical flows to exceed the soft draft cap.
  allowNewDraftAtCap?: boolean;
  // Subject of the cap message, e.g. "This feature". Defaults to "This".
  capNoun?: string;
  /** Active drafts this flow may write to. */
  writableDraftKeys?: K[];
  /** Conflict/alert banner rendered inside the selector (see DraftSelector). */
  alert?: ReactNode;
}) {
  const activeDraftKeys = writableDraftKeys ?? allActiveDraftKeys;
  const singleOption =
    !canDraft ||
    (!canAutoPublish && (hideExisting || activeDraftKeys.length === 0));

  const atDraftCap =
    !hideExisting && maxDrafts > 0 && activeDraftKeys.length >= maxDrafts;
  const newDraftBlocked = atDraftCap && !isAdmin && !allowNewDraftAtCap;

  // Reconcile externally controlled mode after permissions and drafts change.
  useEffect(() => {
    if (!canDraft) {
      if (mode !== "publish") {
        setSelectedDraft(null);
        setMode("publish");
      }
    } else if (singleOption && mode !== "new") {
      setSelectedDraft(null);
      setMode("new");
    } else if (newDraftBlocked && mode === "new") {
      setMode("existing");
      setSelectedDraft(selectedDraft ?? activeDraftKeys[0] ?? null);
    } else if (mode === "publish" && !canAutoPublish) {
      setMode("new");
      setSelectedDraft(null);
    } else if (
      mode === "existing" &&
      selectedDraft !== null &&
      writableDraftKeys &&
      !writableDraftKeys.includes(selectedDraft)
    ) {
      const fallback = writableDraftKeys[0] ?? null;
      setSelectedDraft(fallback);
      if (fallback === null) setMode("new");
    }
  }, [
    canAutoPublish,
    writableDraftKeys,
    canDraft,
    mode,
    singleOption,
    newDraftBlocked,
    selectedDraft,
    activeDraftKeys,
    setMode,
    setSelectedDraft,
  ]);

  return (
    <DraftSelector
      hasActiveDrafts={!hideExisting && activeDraftKeys.length > 0}
      mode={mode}
      setMode={setMode}
      canAutoPublish={canAutoPublish}
      approvalRequired={approvalRequired}
      defaultExpanded={defaultExpanded}
      triggerPrefix={triggerPrefix}
      existingDraftLabel={existingDraftLabel}
      revisionDropdown={revisionDropdown}
      metadataOnly={metadataOnly}
      canDraft={canDraft}
      singleOption={singleOption}
      recommendExisting={atDraftCap}
      alert={alert}
      newDraftDisabled={newDraftBlocked}
      newDraftDisabledReason={
        newDraftBlocked
          ? `${capNoun} is at your organization's cap of ${maxDrafts} active draft${
              maxDrafts === 1 ? "" : "s"
            }. Add to an existing draft, or publish/discard one first.`
          : undefined
      }
    />
  );
}

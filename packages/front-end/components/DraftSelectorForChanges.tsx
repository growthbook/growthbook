import { ReactNode, useEffect } from "react";
import DraftSelector, { DraftMode } from "@/components/DraftSelector";

export type { DraftMode };

/**
 * Shared shell logic for the "publish now / add to existing draft / create new
 * draft" picker. Lifted verbatim from the feature implementation; entity
 * wrappers (features, saved groups, constants) inject their entity-specific
 * inputs as props. Generic over the draft key type `K` (features key by version
 * `number`; saved groups/constants key by revision id `string`).
 *
 * The shell owns: active-draft → singleOption computation, the org soft
 * draft-cap logic, the render-time mode auto-correction, and the final
 * <DraftSelector .../> prop wiring. It contains NO environment logic — the
 * entity bundles any environment badges into `revisionDropdown`.
 */
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
  // Whether the user may author drafts. Without it publishing is the only route
  // their change can take, so the draft options aren't offered.
  canDraft?: boolean;
  // Soft per-entity draft cap (org setting). 0 means no cap.
  maxDrafts?: number;
  isAdmin?: boolean;
  // Keep "create a new draft" available even when the org's soft draft cap is
  // reached — for critical flows (revert, archive) that shouldn't be blocked.
  allowNewDraftAtCap?: boolean;
  // Subject of the cap message, e.g. "This feature". Defaults to "This".
  capNoun?: string;
  /**
   * Draft keys this flow may WRITE into, when that is narrower than "active".
   * Offering another author's draft to a caller the endpoint refuses turns a
   * picker choice into a 403 — see RevisionDraftSelectorForChanges.
   */
  writableDraftKeys?: K[];
}) {
  const activeDraftKeys = writableDraftKeys ?? allActiveDraftKeys;
  const singleOption = !canDraft
    ? true
    : hideExisting
      ? !canAutoPublish
      : activeDraftKeys.length === 0 && !canAutoPublish;

  // Soft per-entity draft cap (org setting). At/over the cap we steer users to
  // an existing draft and block creating a new one — except admins and critical
  // flows (revert, archive) that opt in via `allowNewDraftAtCap`.
  const atDraftCap =
    !hideExisting && maxDrafts > 0 && activeDraftKeys.length >= maxDrafts;
  const newDraftBlocked = atDraftCap && !isAdmin && !allowNewDraftAtCap;

  // Correcting a mode the parent can't reach itself, in an effect rather than
  // during render: these call the PARENT's setters, and React refuses to update
  // another component mid-render.
  useEffect(() => {
    // Without draft rights the only route is publishing, so that's the one mode.
    if (!canDraft) {
      if (mode !== "publish") {
        setSelectedDraft(null);
        setMode("publish");
      }
    } else if (singleOption && mode !== "new") {
      // Otherwise the sole remaining mode is "new"; keep the form in sync in case
      // the parent initialised with a stale value.
      setSelectedDraft(null);
      setMode("new");
    } else if (newDraftBlocked && mode === "new") {
      // "new" is disabled at the cap — fall back to the most recent active draft.
      setMode("existing");
      setSelectedDraft(selectedDraft ?? activeDraftKeys[0] ?? null);
    }
  }, [
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

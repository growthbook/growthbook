import { ReactNode, useMemo, useState } from "react";
import { Revision } from "shared/enterprise";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { useAuth } from "@/services/auth";
import { DraftMode } from "@/components/DraftSelector";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";
import LoadingSpinner from "@/components/LoadingSpinner";

const DRAFT_STATUSES = [
  "draft",
  "pending-review",
  "changes-requested",
  "approved",
];
const isDraftRevision = (r: Revision) => DRAFT_STATUSES.includes(r.status);

export interface Props {
  // Entity being archived/unarchived (e.g. "Saved Group", "Constant"). Used in
  // headers and copy.
  entityNoun: string;
  // The live entity id and its current archived state.
  entityId: string;
  isArchived: boolean;
  // PUT endpoint base for the entity (e.g. "/saved-groups", "/constants").
  apiPathBase: string;
  // `openRevisions` seeds the default selected draft. (The draft selector node
  // is supplied by the wrapper, which already has `allRevisions`.)
  openRevisions: Revision[];
  // Org requires approval for archive/unarchive of this entity.
  approvalRequired: boolean;
  // Viewer can bypass approval (admin) — records a bypass instead of merging.
  canBypassApproval: boolean;
  // References blocking: reference count + loading state. Archiving a
  // still-referenced entity is blocked (it would silently drop config from the
  // referencing items); unarchiving is always allowed.
  referenceCount: number;
  referencesLoading: boolean;
  // The reference lookup failed — block archiving rather than fail open.
  referencesError?: boolean;
  // The entity's reference list node, rendered when archiving is blocked.
  referencesList: ReactNode;
  // "hard" (default): references hard-block the archive client-side. "soft": the
  // server decides (it may allow, or return a soft warning the user confirms via
  // the shared apiCall handler) — references render only as informational context.
  referenceBlockMode?: "hard" | "soft";
  // Renders the entity's DraftSelectorForChanges (publish-now vs. create-draft
  // picker), reusing the same control the edit modals use.
  renderDraftSelector: (opts: {
    mode: DraftMode;
    setMode: (m: DraftMode) => void;
    selectedDraftId: string | null;
    setSelectedDraftId: (v: string | null) => void;
    canAutoPublish: boolean;
    approvalRequired: boolean;
  }) => ReactNode;
  trackingEventModalType: string;
  close: () => void;
  onRevisionCreated?: (revision: Revision) => void;
  selectFlow?: (revision: Revision | null) => void;
  // Called after a successful submit (e.g. mutate / mutateDefinitions).
  onSaved?: () => void | Promise<void>;
}

// Entity-agnostic archive/unarchive modal. The change flows through the
// revision system (so it shows up in history) via the draft selector — create a
// new draft, add to an existing one, or publish now. Thin per-entity wrappers
// (SavedGroupArchiveModal, ConstantArchiveModal) supply the entity's reference
// list, draft selector, API path, and tracking type.
export default function ArchiveModal({
  entityNoun,
  entityId,
  isArchived,
  apiPathBase,
  openRevisions,
  approvalRequired,
  canBypassApproval,
  referenceCount,
  referencesLoading,
  referencesError = false,
  referencesList,
  referenceBlockMode = "hard",
  renderDraftSelector,
  trackingEventModalType,
  close,
  onRevisionCreated,
  selectFlow,
  onSaved,
}: Props) {
  const { apiCall } = useAuth();

  // Archive/unarchive always requires review when approval flows are enabled.
  const archiveGated = approvalRequired;
  const canAutoPublish = canBypassApproval || !archiveGated;

  const activeDrafts = useMemo(
    () => openRevisions.filter(isDraftRevision),
    [openRevisions],
  );

  const [mode, setMode] = useState<DraftMode>(archiveGated ? "new" : "publish");
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(
    activeDrafts[0]?.id ?? null,
  );

  // Reference-blocking policy is archive-only: archiving a still-referenced
  // entity would silently drop its config from every referencing item.
  // Unarchiving a referenced entity is safe and always allowed.
  // Soft mode: the server is the source of truth — it allows a no-op/unused
  // archive outright and returns a soft warning (which the shared apiCall
  // handler asks the user to confirm) only when the entity is actually serving a
  // value. So don't pre-warn or block on references here; that would nag on the
  // common harmless case.
  const soft = referenceBlockMode === "soft";
  const blockedByReferences = !isArchived && referenceCount > 0 && !soft;
  const canSubmit =
    isArchived ||
    soft ||
    (!referencesLoading && !referencesError && referenceCount === 0);
  const lowerNoun = entityNoun.toLowerCase();

  return (
    <ModalStandard
      open={true}
      trackingEventModalType={trackingEventModalType}
      header={isArchived ? `Unarchive ${entityNoun}` : `Archive ${entityNoun}`}
      size="lg"
      close={close}
      cta={
        mode === "publish"
          ? isArchived
            ? "Unarchive"
            : "Archive"
          : "Save to draft"
      }
      ctaColor={mode === "publish" ? "red" : "violet"}
      ctaEnabled={canSubmit}
      submit={async () => {
        const desiredArchived = !isArchived;
        const params = new URLSearchParams();

        if (mode === "publish") {
          // Archive/unarchive still flows through the revision system so it
          // shows up in history. When approval is required but the caller has
          // bypass permission, record it as a bypass; otherwise auto-merge.
          if (archiveGated && canBypassApproval) {
            params.set("bypassApproval", "1");
          } else {
            params.set("autoPublish", "1");
          }
        } else if (mode === "existing" && selectedDraftId) {
          params.set("revisionId", selectedDraftId);
        } else {
          // mode === "new"
          params.set("forceCreateRevision", "1");
        }

        const qs = params.toString();
        const res = await apiCall<{
          status: number;
          requiresApproval?: boolean;
          revision?: Revision;
        }>(`${apiPathBase}/${entityId}${qs ? `?${qs}` : ""}`, {
          method: "PUT",
          body: JSON.stringify({ archived: desiredArchived }),
        });

        if (res?.revision) {
          onRevisionCreated?.(res.revision);
          if (mode === "new" || mode === "existing") {
            selectFlow?.(res.revision);
          }
        }
        await onSaved?.();
        close();
      }}
    >
      {renderDraftSelector({
        mode,
        setMode,
        selectedDraftId,
        setSelectedDraftId,
        canAutoPublish,
        approvalRequired: archiveGated,
      })}
      {isArchived ? (
        <p>
          Are you sure you want to continue? This will make the {lowerNoun}{" "}
          active again.
        </p>
      ) : referencesLoading && !soft ? (
        <Text color="text-disabled">
          <LoadingSpinner /> Checking {lowerNoun} references...
        </Text>
      ) : referencesError && !soft ? (
        <Callout status="error" mb="4">
          Could not check {lowerNoun} references. Archiving is blocked until
          references can be verified — try again later.
        </Callout>
      ) : blockedByReferences ? (
        <>
          <Callout status="error" mb="4">
            <Text as="p" weight="semibold" mb="2">
              Cannot archive {lowerNoun}
            </Text>
            <Text as="p" mb="0">
              Before you can archive this {lowerNoun}, you will need to remove
              any references to it. Check the following item
              {referenceCount > 1 ? "s" : ""} below:
            </Text>
          </Callout>
          {referencesList}
        </>
      ) : (
        <p>
          Are you sure you want to continue? This will make the {lowerNoun}{" "}
          inactive.
        </p>
      )}
    </ModalStandard>
  );
}

import { ReactNode, useState } from "react";
import { Revision } from "shared/enterprise";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import { useAuth } from "@/services/auth";
import { DraftMode } from "@/components/DraftSelector";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
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
  entityNoun: string;
  entityId: string;
  isArchived: boolean;
  apiPathBase: string;
  openRevisions: Revision[];
  approvalRequired: boolean;
  canBypassApproval: boolean;
  // Archive uses delete authority; unarchive uses publish authority.
  canLand: boolean;
  referenceCount: number;
  referencesLoading: boolean;
  referencesError?: boolean;
  referencesList: ReactNode;
  // Soft mode allows an acknowledged server-side warning instead of blocking.
  referenceBlockMode?: "hard" | "soft";
  elevatedWarning?: boolean;
  preserveNounCase?: boolean;
  renderDraftSelector: (opts: {
    mode: DraftMode;
    setMode: (m: DraftMode) => void;
    selectedDraftId: string | null;
    setSelectedDraftId: (v: string | null) => void;
    canAutoPublish: boolean;
    approvalRequired: boolean;
    canWriteIntoDraft?: (revision: Revision) => boolean;
    canDraft?: boolean;
  }) => ReactNode;
  // Keep initial selection and picker filtering aligned.
  canWriteIntoDraft?: (revision: Revision) => boolean;
  canStageDraft?: boolean;
  trackingEventModalType: string;
  close: () => void;
  onRevisionCreated?: (revision: Revision) => void;
  selectFlow?: (revision: Revision | null) => void;
  onSaved?: () => void | Promise<void>;
}

export default function ArchiveModal({
  entityNoun,
  entityId,
  isArchived,
  apiPathBase,
  openRevisions,
  approvalRequired,
  canBypassApproval,
  canLand,
  referenceCount,
  referencesLoading,
  referencesError = false,
  referencesList,
  referenceBlockMode = "hard",
  elevatedWarning = false,
  preserveNounCase = false,
  renderDraftSelector,
  canWriteIntoDraft,
  canStageDraft,
  trackingEventModalType,
  close,
  onRevisionCreated,
  selectFlow,
  onSaved,
}: Props) {
  const { apiCall } = useAuth();

  // Archive/unarchive always requires review when approval flows are enabled.
  const archiveGated = approvalRequired;
  // Landing needs the flip's own authority on top of the approval question;
  // without it the modal can still stage the change as a draft.
  const canAutoPublish = canLand && (canBypassApproval || !archiveGated);

  const [mode, setMode] = useState<DraftMode>(
    archiveGated || !canLand ? "new" : "publish",
  );
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(
    () =>
      openRevisions.find(
        (r) => isDraftRevision(r) && (canWriteIntoDraft?.(r) ?? true),
      )?.id ?? null,
  );

  // Reference-blocking policy is archive-only: archiving a still-referenced
  // entity would silently drop its config from every referencing item.
  // Unarchiving a referenced entity is safe and always allowed.
  // Soft mode: the server is the source of truth — it allows a no-op/unused
  // archive outright and returns a soft warning (which the shared apiCall
  // handler asks the user to confirm) only when the entity is actually serving a
  // value. So don't pre-warn or block on references here; that would nag on the
  // common harmless case.
  const [acknowledged, setAcknowledged] = useState(false);
  const soft = referenceBlockMode === "soft";
  const blockedByReferences = !isArchived && referenceCount > 0 && !soft;
  // Soft mode: archiving a still-referenced entity is allowed, but the caller
  // must acknowledge the live references first (the acknowledgment sends
  // `ignoreWarnings`). References may still be loading (referenceCount
  // transiently 0); the server re-checks and the global soft-warning dialog is
  // the backstop if the client under-counts.
  const needsAcknowledge = soft && !isArchived && referenceCount > 0;
  const canSubmit =
    isArchived ||
    (soft
      ? !needsAcknowledge || acknowledged
      : !referencesLoading && !referencesError && referenceCount === 0);
  const lowerNoun = preserveNounCase ? entityNoun : entityNoun.toLowerCase();

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
          body: JSON.stringify({
            archived: desiredArchived,
            // The acknowledgment clears the server's soft archive-dependents
            // warning. Only sent when the user ticked the box for a referenced
            // entity; an unreferenced archive doesn't need it.
            ...(needsAcknowledge ? { ignoreWarnings: true } : {}),
          }),
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
        canWriteIntoDraft,
        canDraft: canStageDraft,
      })}
      {isArchived ? (
        <p>
          Are you sure you want to continue?{" "}
          {mode === "publish"
            ? `This will make the ${lowerNoun} active again.`
            : `The ${lowerNoun} becomes active again when this draft is published.`}
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
      ) : needsAcknowledge ? (
        <>
          <Callout status={elevatedWarning ? "error" : "warning"} mb="4">
            <Text as="p" weight="semibold" mb="2">
              {elevatedWarning
                ? `This ${lowerNoun} is consumed by live Feature Flags`
                : `This ${lowerNoun} is still referenced`}
            </Text>
            <Text as="p" mb="0">
              {elevatedWarning
                ? "Archiving it will break the following live Feature Flag" +
                  (referenceCount > 1 ? "s" : "") +
                  ":"
                : `Archiving it will remove it from the following item${
                    referenceCount > 1 ? "s" : ""
                  }:`}
            </Text>
          </Callout>
          {referencesList}
          <Checkbox
            mt="4"
            weight="regular"
            value={acknowledged}
            setValue={setAcknowledged}
            label={
              // The consequence lands when the archive PUBLISHES, not when it is
              // staged — unconditional wording implied a draft took effect on its
              // own. True of the ordinary reference warning as much as the elevated
              // one, so both arms branch on the mode.
              elevatedWarning
                ? mode === "publish"
                  ? "I understand this will break live Feature Flags and want to archive anyway."
                  : "I understand this will break live Feature Flags when the draft is published, and want to continue."
                : mode === "publish"
                  ? `I acknowledge these references and want to archive this ${lowerNoun} anyway.`
                  : `I acknowledge these references and want to archive this ${lowerNoun} when the draft is published.`
            }
          />
        </>
      ) : (
        <p>
          Are you sure you want to continue?{" "}
          {mode === "publish"
            ? `This will make the ${lowerNoun} inactive.`
            : `The ${lowerNoun} becomes inactive when this draft is published.`}
        </p>
      )}
    </ModalStandard>
  );
}

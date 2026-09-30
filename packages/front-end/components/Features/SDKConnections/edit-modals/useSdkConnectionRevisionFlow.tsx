import { ReactNode, useState } from "react";
import { Revision, getSdkConnectionApprovalRule } from "shared/enterprise";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { draftValuesEqual } from "shared/util";
import { DraftMode } from "@/components/DraftSelector";
import RevisionDraftSelectorForChanges from "@/components/Revision/RevisionDraftSelectorForChanges";
import useOrgSettings from "@/hooks/useOrgSettings";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";

// Props the SDK connection page threads through to each edit modal so they can
// participate in the revision / approval flow (draft selector at the top +
// routing the PUT through the right revision params).
export type SdkConnectionRevisionProps = {
  onRevisionCreated?: (revision: Revision) => void;
  openRevisions?: Revision[];
  allRevisions?: Revision[];
  selectedRevision?: Revision | null;
  onSelectRevision?: (revision: Revision | null) => void;
  approvalRequired?: boolean;
  canAutoPublish?: boolean;
  metadataReviewRequired?: boolean;
};

export type SdkConnectionScope = {
  projects?: string[];
  environment?: string;
};

const DRAFT_STATUSES: ReadonlySet<Revision["status"]> = new Set([
  "draft",
  "pending-review",
  "changes-requested",
  "approved",
]);

// Only open revisions accept writes; merged/discarded ones are viewable from
// the header dropdown and `?v=` but must never be sent as `revisionId`.
export function isDraftRevision(
  revision: Revision | null | undefined,
): revision is Revision {
  return !!revision && DRAFT_STATUSES.has(revision.status);
}

export function canBypassSdkConnectionApproval(
  permissionsUtil: ReturnType<typeof usePermissionsUtil>,
  role: string | undefined,
  projects: string[],
): boolean {
  if (role === "admin") return true;
  return projects.length
    ? projects.every((p) =>
        permissionsUtil.canBypassSDKConnectionApprovalChecks({
          project: p || "",
        }),
      )
    : permissionsUtil.canBypassSDKConnectionApprovalChecks({ project: "" });
}

// Flattened view of the connection the modal was seeded from, so the body can
// be diffed field-by-field against what the user actually saw.
function seededValue(connection: SDKConnectionInterface, key: string): unknown {
  if (key === "proxyEnabled") return connection.proxy?.enabled;
  if (key === "proxyHost") return connection.proxy?.host;
  return (connection as unknown as Record<string, unknown>)[key];
}

/**
 * Encapsulates the SDK connection revision/approval flow shared by the
 * per-section edit modals. Returns a `DraftSelector` node to render at the top
 * of the modal and a `save` helper that PUTs only the changed fields with the
 * correct revision params and selects the resulting revision.
 *
 * `connection` is the state the modal was seeded from (the selected draft's
 * effective state when one is selected), and `proposedScope` is the form's
 * current projects/environment so approval is judged the way the server does:
 * against the live scope OR the proposed one.
 */
export function useSdkConnectionRevisionFlow({
  connection,
  mutate,
  proposedScope,
  onRevisionCreated,
  openRevisions,
  allRevisions,
  selectedRevision,
  onSelectRevision,
  approvalRequired,
  canAutoPublish,
  metadataReviewRequired,
}: {
  connection: SDKConnectionInterface;
  mutate: () => Promise<unknown> | void;
  proposedScope?: SdkConnectionScope;
} & SdkConnectionRevisionProps): {
  revisionAware: boolean;
  draftSelector: ReactNode;
  save: (body: Record<string, unknown>) => Promise<void>;
} {
  const { apiCall } = useAuth();
  const { user, hasCommercialFeature } = useUser();
  const settings = useOrgSettings();
  const permissionsUtil = usePermissionsUtil();

  const revisionAware =
    !!connection.id &&
    (approvalRequired !== undefined || onRevisionCreated !== undefined);

  const selectedDraft = isDraftRevision(selectedRevision)
    ? selectedRevision
    : null;

  const proposedRule =
    revisionAware && proposedScope && hasCommercialFeature("require-approvals")
      ? getSdkConnectionApprovalRule(settings.approvalFlows, proposedScope)
      : undefined;
  const effectiveApprovalRequired = !!approvalRequired || !!proposedRule;
  // Same precedence as the server: the live rule wins over the proposed one.
  const effectiveMetadataReviewRequired = approvalRequired
    ? (metadataReviewRequired ?? true)
    : (proposedRule?.requireMetadataReview ?? true);
  const effectiveCanAutoPublish =
    !effectiveApprovalRequired ||
    ((canAutoPublish ?? true) &&
      (!proposedRule ||
        canBypassSdkConnectionApproval(
          permissionsUtil,
          user?.role,
          proposedScope?.projects ?? connection.projects ?? [],
        )));

  // Prefer the draft being viewed, then the user's own open draft. Never
  // default to publishing while a draft is selected.
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(() => {
    if (selectedDraft) return selectedDraft.id;
    const myDraft = (openRevisions ?? []).find(
      (r) => isDraftRevision(r) && r.authorId === user?.id,
    );
    return myDraft?.id ?? null;
  });
  const [draftMode, setDraftMode] = useState<DraftMode>(() =>
    selectedDraftId
      ? "existing"
      : effectiveApprovalRequired
        ? "new"
        : "publish",
  );

  const metadataOnlyRevisionFlow =
    effectiveApprovalRequired && !effectiveMetadataReviewRequired;

  const draftSelector =
    revisionAware && connection.id ? (
      <RevisionDraftSelectorForChanges
        entityId={connection.id}
        openRevisions={openRevisions ?? []}
        allRevisions={allRevisions ?? []}
        mode={draftMode}
        setMode={setDraftMode}
        selectedDraftId={selectedDraftId}
        setSelectedDraftId={setSelectedDraftId}
        canAutoPublish={effectiveCanAutoPublish}
        approvalRequired={effectiveApprovalRequired}
        metadataOnly={metadataOnlyRevisionFlow}
        defaultExpanded={!effectiveCanAutoPublish}
        dropdownRequiresApproval={false}
      />
    ) : null;

  const save = async (body: Record<string, unknown>) => {
    const changed: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      const absentDefault = typeof value === "boolean" ? false : undefined;
      if (
        !draftValuesEqual(value, seededValue(connection, key), absentDefault)
      ) {
        changed[key] = value;
      }
    }

    // The selector's effect reconciles this too; the save-time coercion is the
    // safety net so a publish is never sent where the scope forbids it.
    const mode: DraftMode =
      draftMode === "publish" && !effectiveCanAutoPublish ? "new" : draftMode;

    if (mode === "publish" && Object.keys(changed).length === 0) {
      await mutate();
      return;
    }

    const params = new URLSearchParams();
    if (revisionAware) {
      if (mode === "publish") {
        params.set("autoPublish", "1");
        if (effectiveApprovalRequired) {
          params.set("bypassApproval", "1");
        }
      } else if (mode === "existing" && selectedDraftId) {
        params.set("revisionId", selectedDraftId);
      } else {
        params.set("forceCreateRevision", "1");
      }
    }
    const queryString = params.toString();
    const url = `/sdk-connections/${connection.id}${
      queryString ? `?${queryString}` : ""
    }`;

    const res = await apiCall<{
      status: number;
      requiresApproval?: boolean;
      revision?: Revision;
    }>(url, {
      method: "PUT",
      body: JSON.stringify(changed),
    });

    if (res?.revision) {
      // A merged (auto-published) revision is the new live version, which
      // onRevisionCreated already navigates to.
      onRevisionCreated?.(res.revision);
      if (res.revision.status !== "merged") {
        onSelectRevision?.(res.revision);
      }
    }
    await mutate();
  };

  return { revisionAware, draftSelector, save };
}

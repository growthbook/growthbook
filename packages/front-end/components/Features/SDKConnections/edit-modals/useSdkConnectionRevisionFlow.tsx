import { useState } from "react";
import { Revision, getSdkConnectionGoverningRules } from "shared/enterprise";
import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { draftValuesEqual } from "shared/util";
import { DraftMode } from "@/components/DraftSelector";
import useOrgSettings from "@/hooks/useOrgSettings";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";

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

// Merged/discarded revisions are viewable but never sent as `revisionId`.
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
          project: p,
        }),
      )
    : permissionsUtil.canBypassSDKConnectionApprovalChecks({ project: "" });
}

function seededValue(connection: SDKConnectionInterface, key: string): unknown {
  if (key === "proxyEnabled") return connection.proxy?.enabled;
  if (key === "proxyHost") return connection.proxy?.host;
  return (connection as unknown as Record<string, unknown>)[key];
}

// Sends only what differs from the saved connection, to an open draft, a new
// one, or live.
export async function saveSdkConnectionChanges({
  apiCall,
  connection,
  body,
  mode,
  draftId,
  bypassApproval,
  onRevisionCreated,
  onSelectRevision,
  mutate,
}: {
  apiCall: ReturnType<typeof useAuth>["apiCall"];
  connection: SDKConnectionInterface;
  body: Record<string, unknown>;
  mode: DraftMode;
  draftId: string | null;
  // Publishing past an approval rule.
  bypassApproval: boolean;
  onRevisionCreated?: (revision: Revision) => void;
  onSelectRevision?: (revision: Revision | null) => void;
  mutate: () => Promise<unknown> | void;
}) {
  const changed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    const absentDefault = typeof value === "boolean" ? false : undefined;
    if (!draftValuesEqual(value, seededValue(connection, key), absentDefault)) {
      changed[key] = value;
    }
  }
  // A no-op save must not mint an empty draft.
  if (Object.keys(changed).length === 0) {
    await mutate();
    return;
  }

  const params = new URLSearchParams();
  if (mode === "publish") {
    params.set("autoPublish", "1");
    if (bypassApproval) params.set("bypassApproval", "1");
  } else if (mode === "existing" && draftId) {
    params.set("revisionId", draftId);
  } else {
    params.set("forceCreateRevision", "1");
  }

  const res = await apiCall<{
    status: number;
    requiresApproval?: boolean;
    revision?: Revision;
  }>(`/sdk-connections/${connection.id}?${params.toString()}`, {
    method: "PUT",
    body: JSON.stringify(changed),
  });

  const revision = res?.revision ?? null;
  if (revision) onRevisionCreated?.(revision);
  await mutate();
  // Selected once the revisions have reloaded: before then the page can't
  // find a new draft (one whose first save also wrote live's revision) and
  // falls back to live. A merged revision is live, where it already is.
  if (revision && revision.status !== "merged") {
    onSelectRevision?.(revision);
  }
}

// Where an edit lands: an open draft, a new one, or live. As on the server,
// approval applies when the live OR proposed scope matches a rule.
export function useSdkConnectionRevisionFlow({
  connection,
  mutate,
  proposedScope,
  onRevisionCreated,
  openRevisions,
  selectedRevision,
  onSelectRevision,
  approvalRequired,
  canAutoPublish,
  metadataReviewRequired,
}: {
  connection: SDKConnectionInterface;
  mutate: () => Promise<unknown> | void;
  proposedScope?: SdkConnectionScope;
} & SdkConnectionRevisionProps) {
  const { apiCall } = useAuth();
  const { user, hasCommercialFeature } = useUser();
  const settings = useOrgSettings();
  const permissionsUtil = usePermissionsUtil();

  const proposedRules =
    proposedScope && hasCommercialFeature("require-approvals")
      ? getSdkConnectionGoverningRules(settings.approvalFlows, proposedScope)
      : [];
  const effectiveApprovalRequired =
    !!approvalRequired || proposedRules.length > 0;
  // As on the server, any governing rule (live or proposed) can require it.
  const effectiveMetadataReviewRequired =
    (!!approvalRequired && (metadataReviewRequired ?? true)) ||
    proposedRules.some((r) => r.requireMetadataReview !== false);
  const effectiveCanAutoPublish =
    !effectiveApprovalRequired ||
    ((canAutoPublish ?? true) &&
      (!proposedRules.length ||
        canBypassSdkConnectionApproval(
          permissionsUtil,
          user?.role,
          proposedScope?.projects ?? connection.projects ?? [],
        )));

  // Prefer the draft being viewed, then the user's own open draft. Never
  // default to publishing while a draft is selected.
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(() => {
    if (isDraftRevision(selectedRevision)) return selectedRevision.id;
    const myDraft = (openRevisions ?? []).find(
      (r) => isDraftRevision(r) && r.authorId === user?.id,
    );
    return myDraft?.id ?? null;
  });
  const [mode, setMode] = useState<DraftMode>(() =>
    selectedDraftId
      ? "existing"
      : effectiveApprovalRequired
        ? "new"
        : "publish",
  );

  const save = async (body: Record<string, unknown>) =>
    saveSdkConnectionChanges({
      apiCall,
      connection,
      body,
      // Never publish where the scope forbids it.
      mode: mode === "publish" && !effectiveCanAutoPublish ? "new" : mode,
      draftId: selectedDraftId,
      bypassApproval: effectiveApprovalRequired,
      onRevisionCreated,
      onSelectRevision,
      mutate,
    });

  return {
    mode,
    setMode,
    selectedDraftId,
    setSelectedDraftId,
    approvalRequired: effectiveApprovalRequired,
    canAutoPublish: effectiveCanAutoPublish,
    // Approval required, but not for metadata: the draft is just a revision.
    metadataOnly: effectiveApprovalRequired && !effectiveMetadataReviewRequired,
    save,
  };
}

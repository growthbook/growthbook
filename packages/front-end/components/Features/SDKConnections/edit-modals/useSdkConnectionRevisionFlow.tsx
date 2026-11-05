import { useEffect, useState } from "react";
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

export type SaveDestination = {
  mode: DraftMode;
  drafts: { id: string; label: string }[];
  selectedDraftId: string | null;
  selectedDraftLabel: string | null;
  canAutoPublish: boolean;
  approvalRequired: boolean;
  metadataOnly: boolean;
  // Only a new draft is possible, so there is nothing to choose.
  singleOption: boolean;
  choose: (mode: DraftMode, draftId?: string | null) => void;
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

// As on the server, approval applies when the live OR proposed scope matches.
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
  destination: SaveDestination;
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

  const proposedRules =
    revisionAware && proposedScope && hasCommercialFeature("require-approvals")
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

  const activeDrafts = (openRevisions ?? []).filter(isDraftRevision);
  // Drafts are named as in the revision dropdown: title, else their position.
  const draftLabel = (revision: Revision) =>
    revision.title ||
    `Revision ${
      (allRevisions ?? []).filter(
        (r) => new Date(r.dateCreated) <= new Date(revision.dateCreated),
      ).length
    }`;
  const singleOption = !effectiveCanAutoPublish && activeDrafts.length === 0;

  // Keep the destination valid as permissions and drafts change.
  useEffect(() => {
    if (singleOption && draftMode !== "new") {
      setSelectedDraftId(null);
      setDraftMode("new");
    } else if (draftMode === "publish" && !effectiveCanAutoPublish) {
      setSelectedDraftId(null);
      setDraftMode("new");
    }
  }, [singleOption, draftMode, effectiveCanAutoPublish]);

  const selectedDraftRevision =
    draftMode === "existing" && selectedDraftId
      ? ([...(allRevisions ?? []), ...(openRevisions ?? [])].find(
          (r) => r.id === selectedDraftId,
        ) ?? null)
      : null;

  const destination: SaveDestination = {
    mode: draftMode,
    drafts: activeDrafts.map((r) => ({ id: r.id, label: draftLabel(r) })),
    selectedDraftId: draftMode === "existing" ? selectedDraftId : null,
    selectedDraftLabel: selectedDraftRevision
      ? draftLabel(selectedDraftRevision)
      : null,
    canAutoPublish: effectiveCanAutoPublish,
    approvalRequired: effectiveApprovalRequired,
    metadataOnly: metadataOnlyRevisionFlow,
    singleOption,
    choose: (mode, draftId = null) => {
      setDraftMode(mode);
      setSelectedDraftId(draftId);
    },
  };

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

    // Safety net: never publish where the scope forbids it.
    const mode: DraftMode =
      draftMode === "publish" && !effectiveCanAutoPublish ? "new" : draftMode;

    // A no-op save must not mint an empty draft either.
    if (Object.keys(changed).length === 0) {
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

  return { revisionAware, destination, save };
}

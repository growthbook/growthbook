import { useCallback, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/router";
import { Revision, JsonPatchOperation } from "shared/enterprise";
import { SavedGroupInterface } from "shared/types/saved-group";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";

export function useSavedGroupRevision(
  savedGroupId: string | undefined,
  savedGroupMutate: () => void,
  savedGroup?: SavedGroupInterface,
) {
  const { userId } = useUser();
  const router = useRouter();
  // Stable ref so useCallback can access the latest router without listing it
  // as a dependency (avoids infinite re-run loops when the router object changes).
  const routerRef = useRef(router);
  routerRef.current = router;

  const { apiCall } = useAuth();
  const initializedDefaultSelectionFor = useRef<string | null>(null);

  // Selected revision lives in the URL via `?v=<n>`.
  const urlVersion = router.isReady
    ? (() => {
        const raw = router.query.v;
        if (typeof raw !== "string" || !/^\d+$/.test(raw)) return null;
        const n = Number(raw);
        return Number.isInteger(n) ? n : null;
      })()
    : null;

  const { data, mutate: mutateRevisions } = useApi<{
    revisions: Revision[];
  }>(`/revision/entity/saved-group/${savedGroupId}`, {
    shouldRun: () => !!savedGroupId,
  });

  const openRevisions = useMemo(
    () =>
      (data?.revisions ?? []).filter(
        (f) => !["merged", "discarded"].includes(f.status),
      ),
    [data?.revisions],
  );

  // The "live" version is the version of the most-recently-merged revision —
  // i.e., the merge that actually produced the current on-disk state. This
  // intentionally tracks merge order (`dateUpdated` for merged revisions,
  // which is frozen at merge time since `canUpdate` rejects merged docs)
  // rather than version number, because drafts can be merged out of creation
  // order (an older draft left open while newer ones are merged, then
  // merged later). In that case the highest-numbered merged revision is
  // *not* what's on disk, and using it caused the header dropdown — which
  // already derives its "live" badge from the most-recently-merged
  // revision — to silently snap the user back to a different revision when
  // they tried to select a higher-numbered, locked/merged revision.
  const liveVersion = useMemo<number | null>(() => {
    let latest: { version: number; dateUpdated: number } | null = null;
    for (const r of data?.revisions ?? []) {
      if (r.status !== "merged") continue;
      if (r.version == null) continue;
      const t = new Date(r.dateUpdated).getTime();
      if (latest == null || t > latest.dateUpdated) {
        latest = { version: r.version, dateUpdated: t };
      }
    }
    if (latest != null) return latest.version;
    // No real merged revisions yet: the synthetic "Revision 1" stands in as live.
    if (savedGroup && (data?.revisions?.length ?? 0) === 0) return 1;
    return null;
  }, [data?.revisions, savedGroup]);

  // Refs give `updateUrl` stable access without listing these as dependencies.
  const liveVersionRef = useRef(liveVersion);
  liveVersionRef.current = liveVersion;

  // Derive selected revision from SWR data — single source of truth.
  // Look in ALL revisions (not just open ones) so discarded/merged revisions
  // can still be selected. If the URL version matches the live version, we
  // treat it as the live view (no revision selected).
  const selectedRevision = useMemo(() => {
    const revisions = data?.revisions ?? [];
    if (urlVersion == null) return null;
    if (urlVersion === liveVersion) return null;
    return revisions.find((f) => f.version === urlVersion) ?? null;
  }, [urlVersion, liveVersion, data?.revisions]);

  const selectedRevisionId = selectedRevision?.id ?? null;
  const hasSelectionInUrl = urlVersion != null;

  // Single URL-update helper. Uses routerRef (empty deps) to guarantee stability
  // so effects that depend on it don't re-run every time the router refreshes.
  //
  // Mirrors the features page behavior (see `pages/features/[fid].tsx`): use
  // `router.push` for user-initiated navigation so browser back/forward steps
  // through revisions, and `router.replace` for initial-load or invalid-URL
  // corrections. Preserves unrelated query params and the URL hash.
  //
  // Passing `null` means "go to live" — the URL is populated with the live
  // version so a `?v=` param is always present.
  const updateUrl = useCallback(
    (
      revision: Pick<Revision, "version"> | null,
      { replace = false }: { replace?: boolean } = {},
    ) => {
      const r = routerRef.current;
      if (!r.isReady) return;
      const query: Record<string, string | string[] | undefined> = {
        ...r.query,
      };
      delete query.v;
      const versionToUse = revision?.version ?? liveVersionRef.current;
      if (versionToUse != null) {
        query.v = String(versionToUse);
      }
      const hash = new URL(r.asPath, "http://x").hash.slice(1) || undefined;
      const method = replace ? r.replace : r.push;
      void method({ pathname: r.pathname, query, hash }, undefined, {
        shallow: true,
      });
    },
    [],
  );

  // On initial load, default authors to their own most-recent open draft.
  // Respect any revision already in the URL (deep link / browser back).
  // If no `?v=` is present, populate it with the live version so the URL
  // always carries a version.
  useEffect(() => {
    if (!savedGroupId || !userId) return;
    if (!data) return;
    if (initializedDefaultSelectionFor.current === savedGroupId) return;

    if (hasSelectionInUrl) {
      initializedDefaultSelectionFor.current = savedGroupId;
      return;
    }

    const authoredOpenRevision = openRevisions
      .filter((revision) => revision.authorId === userId)
      .sort(
        (a, b) =>
          new Date(b.dateUpdated).getTime() - new Date(a.dateUpdated).getTime(),
      )[0];

    updateUrl(authoredOpenRevision ?? null, { replace: true });
    initializedDefaultSelectionFor.current = savedGroupId;
  }, [savedGroupId, userId, data, openRevisions, hasSelectionInUrl, updateUrl]);

  // If the URL `?v=` points to a version that doesn't exist (deleted / invalid
  // URL), reset to live. Skip this when `v` equals the live version (live view)
  // or when `v` matches a real revision. This is a URL correction, not a user
  // action, so replace instead of push.
  useEffect(() => {
    if (!data || !hasSelectionInUrl) return;
    if (urlVersion === liveVersion) return;
    if (selectedRevision) return;
    if (liveVersion === null) return;
    updateUrl(null, { replace: true });
  }, [
    data,
    hasSelectionInUrl,
    urlVersion,
    liveVersion,
    selectedRevision,
    updateUrl,
  ]);

  const selectFlow = useCallback(
    (revision: Revision | null) => {
      updateUrl(revision);
    },
    [updateUrl],
  );

  // Called after creating/updating a revision — receives the revision from the backend response.
  // Selects it in the dropdown so the status callout appears.
  const onRevisionCreated = useCallback(
    async (revision: Revision) => {
      // Optimistically update the revision in the SWR cache. If it exists, replace it.
      // Otherwise, add it. This ensures the UI reflects the latest changes immediately.
      await mutateRevisions(
        (current) => {
          const existingIndex = (current?.revisions ?? []).findIndex(
            (r) => r.id === revision.id,
          );
          if (existingIndex !== -1) {
            // Replace existing revision
            const newRevisions = [...(current?.revisions ?? [])];
            newRevisions[existingIndex] = revision;
            return { revisions: newRevisions };
          } else {
            // Add new revision
            return {
              revisions: [...(current?.revisions ?? []), revision],
            };
          }
        },
        { revalidate: true },
      ).catch(() => undefined);
      // The revision may have published immediately (bypass/auto-publish or
      // revert), which mutates the live entity — refresh it too.
      savedGroupMutate();
      updateUrl(revision);
    },
    [mutateRevisions, savedGroupMutate, updateUrl],
  );

  const handlePublish = useCallback(
    async (revisionId: string) => {
      await apiCall(`/revision/${revisionId}/merge`, { method: "POST" });
      // Wait for the revisions list to update before rewriting the URL so the
      // "live version" (max merged version) reflects the newly merged revision.
      const updated = await mutateRevisions();
      savedGroupMutate(); // refresh live saved group data after merge
      const merged = (updated?.revisions ?? data?.revisions ?? []).find(
        (r) => r.id === revisionId,
      );
      updateUrl(merged ?? null);
    },
    [apiCall, mutateRevisions, savedGroupMutate, data?.revisions, updateUrl],
  );

  const handleDiscard = useCallback(
    async (revisionId: string) => {
      await apiCall(`/revision/${revisionId}/close`, { method: "POST" });
      await mutateRevisions();
      updateUrl(null);
    },
    [apiCall, mutateRevisions, updateUrl],
  );

  // Accepts just the revision id so callers don't have to thread the full
  // Revision through the UI. We resolve back to the cached revision so we can
  // preserve selection (which requires knowing either its version or id).
  const handleReopen = useCallback(
    async (revisionId: string) => {
      await apiCall(`/revision/${revisionId}/reopen`, { method: "POST" });
      const updated = await mutateRevisions();
      const reopened = (updated?.revisions ?? data?.revisions ?? []).find(
        (r) => r.id === revisionId,
      );
      if (reopened) updateUrl(reopened);
    },
    [apiCall, mutateRevisions, data?.revisions, updateUrl],
  );

  // Derive whether the current user already has an open revision on this resource
  const userOpenRevision = useMemo(
    () => openRevisions.find((f) => f.authorId === userId) ?? null,
    [openRevisions, userId],
  );

  const hasRealRevisions =
    data !== undefined && (data.revisions?.length ?? 0) > 0;

  // When no real revisions exist yet, synthesize a dummy "Revision 1" representing
  // the initial saved state. This is frontend-only and never persisted.
  const syntheticInitialRevision = useMemo((): Revision | null => {
    if (!savedGroup || !data || data.revisions.length > 0) return null;
    return {
      id: "__initial__",
      authorId: savedGroup.owner,
      version: 1,
      title: "Revision 1",
      target: {
        type: "saved-group" as const,
        id: savedGroup.id,
        snapshot: savedGroup,
        proposedChanges: [] as JsonPatchOperation[],
      },
      status: "merged" as const,
      reviews: [],
      activityLog: [
        {
          id: "initial",
          userId: savedGroup.owner,
          action: "created" as const,
          dateCreated: savedGroup.dateCreated,
        },
      ],
      resolution: {
        action: "merged" as const,
        userId: savedGroup.owner,
        dateCreated: savedGroup.dateCreated,
      },
      dateCreated: savedGroup.dateCreated,
      dateUpdated: savedGroup.dateUpdated,
      organization: savedGroup.organization,
    };
  }, [data, savedGroup]);

  const allRevisions = useMemo(
    () =>
      syntheticInitialRevision
        ? [syntheticInitialRevision]
        : (data?.revisions ?? []),
    [syntheticInitialRevision, data?.revisions],
  );

  return {
    selectedApprovalFlow: selectedRevision,
    selectedApprovalFlowId: selectedRevisionId,
    openApprovalFlows: openRevisions,
    allApprovalFlows: allRevisions,
    hasRealRevisions,
    selectFlow,
    onApprovalFlowCreated: onRevisionCreated,
    handlePublish,
    handleDiscard,
    handleReopen,
    mutateApprovalFlows: mutateRevisions,
    userOpenFlow: userOpenRevision,
  };
}

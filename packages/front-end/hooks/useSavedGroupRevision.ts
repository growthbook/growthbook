import { useCallback, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/router";
import { Revision } from "shared/enterprise";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";

export function useSavedGroupRevision(
  savedGroupId: string | undefined,
  savedGroupMutate: () => void,
) {
  const { userId } = useUser();
  const router = useRouter();
  // Stable ref so useCallback can access the latest router without listing it
  // as a dependency (avoids infinite re-run loops when the router object changes).
  const routerRef = useRef(router);
  routerRef.current = router;

  const { apiCall } = useAuth();
  const initializedDefaultSelectionFor = useRef<string | null>(null);

  // Revision ID lives in ?flow= query param
  const selectedRevisionId = router.isReady
    ? ((router.query.flow as string) ?? null)
    : null;

  const { data, mutate: mutateRevisions } = useApi<{
    revisions: Revision[];
  }>(`/revision/entity/saved-group/${savedGroupId}`, {
    shouldRun: () => !!savedGroupId,
  });

  const openRevisions = useMemo(
    () =>
      (data?.revisions ?? []).filter(
        (f) => !["merged", "closed"].includes(f.status),
      ),
    [data?.revisions],
  );

  // Derive selected revision from SWR data — single source of truth
  // Look in ALL revisions (not just open ones) so closed/merged revisions can be selected
  const selectedRevision = useMemo(
    () =>
      selectedRevisionId
        ? ((data?.revisions ?? []).find((f) => f.id === selectedRevisionId) ??
          null)
        : null,
    [selectedRevisionId, data?.revisions],
  );

  // Single URL-update helper. Uses routerRef (empty deps) to guarantee stability
  // so effects that depend on it don't re-run every time the router refreshes.
  const updateUrl = useCallback((revisionId: string | null) => {
    const r = routerRef.current;
    if (!r.isReady) return;
    const query: Record<string, string> = { sgid: r.query.sgid as string };
    if (revisionId) query.flow = revisionId;
    r.replace({ pathname: r.pathname, query }, undefined, { shallow: true });
  }, []);

  // On initial load, default authors to their own most-recent open draft.
  // Respect any revision already in the URL (deep link / browser back).
  useEffect(() => {
    if (!savedGroupId || !userId) return;
    if (!data) return;
    if (initializedDefaultSelectionFor.current === savedGroupId) return;

    if (selectedRevisionId) {
      initializedDefaultSelectionFor.current = savedGroupId;
      return;
    }

    const authoredOpenRevision = openRevisions
      .filter((revision) => revision.authorId === userId)
      .sort(
        (a, b) =>
          new Date(b.dateUpdated).getTime() - new Date(a.dateUpdated).getTime(),
      )[0];

    if (authoredOpenRevision) {
      updateUrl(authoredOpenRevision.id);
    }
    initializedDefaultSelectionFor.current = savedGroupId;
  }, [
    savedGroupId,
    userId,
    data,
    openRevisions,
    selectedRevisionId,
    updateUrl,
  ]);

  // If the selected revision doesn't exist (deleted), deselect.
  // Guard on `data` to avoid false-positive deselection before SWR has loaded.
  useEffect(() => {
    if (data && selectedRevisionId && !selectedRevision) {
      updateUrl(null);
    }
  }, [data, selectedRevisionId, selectedRevision, updateUrl]);

  const selectFlow = useCallback(
    (revision: Revision | null) => {
      updateUrl(revision?.id ?? null);
    },
    [updateUrl],
  );

  // Called after creating/updating a revision — receives the revision from the backend response.
  // Selects it in the dropdown so the status callout appears.
  const onRevisionCreated = useCallback(
    (revision: Revision) => {
      // Optimistically update the revision in the SWR cache. If it exists, replace it.
      // Otherwise, add it. This ensures the UI reflects the latest changes immediately.
      mutateRevisions(
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
      );
      updateUrl(revision.id);
    },
    [mutateRevisions, updateUrl],
  );

  const handlePublish = useCallback(
    async (revisionId: string) => {
      await apiCall(`/revision/${revisionId}/merge`, { method: "POST" });
      mutateRevisions();
      savedGroupMutate(); // refresh live saved group data after merge
      updateUrl(null);
    },
    [apiCall, mutateRevisions, savedGroupMutate, updateUrl],
  );

  const handleDiscard = useCallback(
    async (revisionId: string) => {
      await apiCall(`/revision/${revisionId}/close`, { method: "POST" });
      mutateRevisions();
      updateUrl(null);
    },
    [apiCall, mutateRevisions, updateUrl],
  );

  const handleReopen = useCallback(
    async (revisionId: string) => {
      await apiCall(`/revision/${revisionId}/reopen`, { method: "POST" });
      mutateRevisions();
      // Keep the reopened revision selected
      updateUrl(revisionId);
    },
    [apiCall, mutateRevisions, updateUrl],
  );

  // Derive whether the current user already has an open revision on this resource
  const userOpenRevision = useMemo(
    () => openRevisions.find((f) => f.authorId === userId) ?? null,
    [openRevisions, userId],
  );

  return {
    selectedApprovalFlow: selectedRevision,
    selectedApprovalFlowId: selectedRevisionId,
    openApprovalFlows: openRevisions,
    allApprovalFlows: data?.revisions ?? [],
    selectFlow,
    onApprovalFlowCreated: onRevisionCreated,
    handlePublish,
    handleDiscard,
    handleReopen,
    mutateApprovalFlows: mutateRevisions,
    userOpenFlow: userOpenRevision,
  };
}

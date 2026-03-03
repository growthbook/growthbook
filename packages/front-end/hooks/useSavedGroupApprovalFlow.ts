import { useCallback, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/router";
import { ApprovalFlow } from "shared/enterprise";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";

export function useSavedGroupApprovalFlow(
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

  // Flow ID lives in ?flow= query param
  const selectedApprovalFlowId = router.isReady
    ? ((router.query.flow as string) ?? null)
    : null;

  const { data, mutate: mutateApprovalFlows } = useApi<{
    approvalFlows: ApprovalFlow[];
  }>(`/approval-flow/entity/saved-group/${savedGroupId}`, {
    shouldRun: () => !!savedGroupId,
  });

  const openApprovalFlows = useMemo(
    () =>
      (data?.approvalFlows ?? []).filter(
        (f) => !["merged", "closed"].includes(f.status),
      ),
    [data?.approvalFlows],
  );

  // Derive selected flow from SWR data — single source of truth
  const selectedApprovalFlow = useMemo(
    () =>
      selectedApprovalFlowId
        ? (openApprovalFlows.find((f) => f.id === selectedApprovalFlowId) ??
          null)
        : null,
    [selectedApprovalFlowId, openApprovalFlows],
  );

  // Single URL-update helper. Uses routerRef (empty deps) to guarantee stability
  // so effects that depend on it don't re-run every time the router refreshes.
  const updateUrl = useCallback((flowId: string | null) => {
    const r = routerRef.current;
    if (!r.isReady) return;
    const query: Record<string, string> = { sgid: r.query.sgid as string };
    if (flowId) query.flow = flowId;
    r.replace({ pathname: r.pathname, query }, undefined, { shallow: true });
  }, []);

  // On initial load, default authors to their own most-recent open draft.
  // Respect any flow already in the URL (deep link / browser back).
  useEffect(() => {
    if (!savedGroupId || !userId) return;
    if (!data) return;
    if (initializedDefaultSelectionFor.current === savedGroupId) return;

    if (selectedApprovalFlowId) {
      initializedDefaultSelectionFor.current = savedGroupId;
      return;
    }

    const authoredOpenFlow = openApprovalFlows
      .filter((flow) => flow.authorId === userId)
      .sort(
        (a, b) =>
          new Date(b.dateUpdated).getTime() - new Date(a.dateUpdated).getTime(),
      )[0];

    if (authoredOpenFlow) {
      updateUrl(authoredOpenFlow.id);
    }
    initializedDefaultSelectionFor.current = savedGroupId;
  }, [
    savedGroupId,
    userId,
    data,
    openApprovalFlows,
    selectedApprovalFlowId,
    updateUrl,
  ]);

  // If the selected flow was merged/closed by another user, gracefully deselect.
  // Guard on `data` to avoid false-positive deselection before SWR has loaded.
  useEffect(() => {
    if (data && selectedApprovalFlowId && !selectedApprovalFlow) {
      updateUrl(null);
    }
  }, [data, selectedApprovalFlowId, selectedApprovalFlow, updateUrl]);

  const selectFlow = useCallback(
    (flow: ApprovalFlow | null) => {
      updateUrl(flow?.id ?? null);
    },
    [updateUrl],
  );

  // Called after creating an approval flow — receives the flow from the backend response.
  // Selects it in the dropdown so the status callout appears.
  const onApprovalFlowCreated = useCallback(
    (flow: ApprovalFlow) => {
      // Optimistically add the new flow to the SWR cache so that when the URL
      // update triggers a re-render, selectedApprovalFlow is non-null. Without
      // this, Effect 2 would see selectedApprovalFlowId set but
      // selectedApprovalFlow=null (SWR re-fetch still in-flight) and
      // immediately clear the URL back to Live.
      mutateApprovalFlows(
        (current) => ({
          approvalFlows: [...(current?.approvalFlows ?? []), flow],
        }),
        { revalidate: true },
      );
      updateUrl(flow.id);
    },
    [mutateApprovalFlows, updateUrl],
  );

  const handlePublish = useCallback(
    async (flowId: string) => {
      await apiCall(`/approval-flow/${flowId}/merge`, { method: "POST" });
      mutateApprovalFlows();
      savedGroupMutate(); // refresh live saved group data after merge
      updateUrl(null);
    },
    [apiCall, mutateApprovalFlows, savedGroupMutate, updateUrl],
  );

  const handleDiscard = useCallback(
    async (flowId: string) => {
      await apiCall(`/approval-flow/${flowId}/close`, { method: "POST" });
      mutateApprovalFlows();
      updateUrl(null);
    },
    [apiCall, mutateApprovalFlows, updateUrl],
  );

  // Derive whether the current user already has an open flow on this resource
  const userOpenFlow = useMemo(
    () => openApprovalFlows.find((f) => f.authorId === userId) ?? null,
    [openApprovalFlows, userId],
  );

  return {
    selectedApprovalFlow,
    selectedApprovalFlowId,
    openApprovalFlows,
    allApprovalFlows: data?.approvalFlows ?? [],
    selectFlow,
    onApprovalFlowCreated,
    handlePublish,
    handleDiscard,
    mutateApprovalFlows,
    userOpenFlow,
  };
}

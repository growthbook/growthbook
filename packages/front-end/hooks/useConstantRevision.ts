import { useCallback, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/router";
import { Revision, JsonPatchOperation } from "shared/enterprise";
import { ConstantInterface } from "shared/types/constant";
import { ConfigInterface } from "shared/types/config";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";

// Revision/approval state for a single constant or config. The revision
// endpoints are generic by entity type; pass entityType "config" for configs.
export function useConstantRevision(
  constantId: string | undefined,
  constantMutate: () => void,
  constant?: ConstantInterface | ConfigInterface,
  entityType: "constant" | "config" = "constant",
) {
  const { userId } = useUser();
  const router = useRouter();
  // Stable ref so callbacks can read the latest router without depending on it.
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
  }>(`/revision/entity/${entityType}/${constantId}`, {
    shouldRun: () => !!constantId,
  });

  const openRevisions = useMemo(
    () =>
      (data?.revisions ?? []).filter(
        (f) => !["merged", "discarded"].includes(f.status),
      ),
    [data?.revisions],
  );

  // The "live" version is the version of the most-recently-merged revision —
  // the merge that produced the current on-disk state. Tracks merge order
  // (frozen `dateUpdated` for merged revisions) rather than version number,
  // since drafts can be merged out of creation order.
  const liveVersion = useMemo<number | null>(() => {
    let latest: { version: number; dateUpdated: number } | null = null;
    for (const r of data?.revisions ?? []) {
      if (r.status !== "merged") continue;
      if (r.version === undefined) continue;
      const t = new Date(r.dateUpdated).getTime();
      if (latest === null || t > latest.dateUpdated) {
        latest = { version: r.version, dateUpdated: t };
      }
    }
    if (latest !== null) return latest.version;
    // No real merged revisions yet: the synthetic "Revision 1" stands in as live.
    // Guard on `data` being loaded so we don't claim version 1 mid-fetch (when
    // the dropdown is still empty) — matches the synthetic-revision condition.
    if (constant && data && data.revisions.length === 0) return 1;
    return null;
  }, [data, constant]);

  const liveVersionRef = useRef(liveVersion);
  liveVersionRef.current = liveVersion;

  // Derive selected revision from SWR data. Look in ALL revisions so
  // discarded/merged revisions can still be selected. A URL version matching
  // the live version is treated as the live view (no revision selected).
  const selectedRevision = useMemo(() => {
    const revisions = data?.revisions ?? [];
    if ((urlVersion ?? null) === null) return null;
    if (urlVersion === liveVersion) return null;
    return revisions.find((f) => f.version === urlVersion) ?? null;
  }, [urlVersion, liveVersion, data?.revisions]);

  const selectedRevisionId = selectedRevision?.id ?? null;
  const hasSelectionInUrl = (urlVersion ?? null) !== null;

  // Single URL-update helper. Uses routerRef (empty deps) so dependent effects
  // don't re-run on every router refresh. `null` means "go to live" — the live
  // version is written so a `?v=` param is always present.
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
      if ((versionToUse ?? null) !== null) {
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
  // Respect any revision already in the URL. If no `?v=`, populate it with live.
  useEffect(() => {
    if (!constantId || !userId) return;
    if (!data) return;
    if (initializedDefaultSelectionFor.current === constantId) return;

    if (hasSelectionInUrl) {
      initializedDefaultSelectionFor.current = constantId;
      return;
    }

    const authoredOpenRevision = openRevisions
      .filter((revision) => revision.authorId === userId)
      .sort(
        (a, b) =>
          new Date(b.dateUpdated).getTime() - new Date(a.dateUpdated).getTime(),
      )[0];

    updateUrl(authoredOpenRevision ?? null, { replace: true });
    initializedDefaultSelectionFor.current = constantId;
  }, [constantId, userId, data, openRevisions, hasSelectionInUrl, updateUrl]);

  // If the URL `?v=` points to a version that doesn't exist, reset to live.
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

  const selectRevision = useCallback(
    (revision: Revision | null) => {
      updateUrl(revision);
    },
    [updateUrl],
  );

  // Called after creating/updating a revision; selects it so the status
  // callout / detail panel appears.
  const onRevisionCreated = useCallback(
    async (revision: Revision) => {
      await mutateRevisions(
        (current) => {
          const existingIndex = (current?.revisions ?? []).findIndex(
            (r) => r.id === revision.id,
          );
          if (existingIndex !== -1) {
            const newRevisions = [...(current?.revisions ?? [])];
            newRevisions[existingIndex] = revision;
            return { revisions: newRevisions };
          }
          return { revisions: [...(current?.revisions ?? []), revision] };
        },
        { revalidate: true },
      ).catch(() => undefined);
      // The revision may have published immediately (bypass/auto-publish or
      // revert), which mutates the live entity — refresh it too.
      constantMutate();
      updateUrl(revision);
    },
    [mutateRevisions, constantMutate, updateUrl],
  );

  const handlePublish = useCallback(
    async (revisionId: string) => {
      await apiCall(`/revision/${revisionId}/merge`, { method: "POST" });
      const updated = await mutateRevisions();
      constantMutate(); // refresh live constant data after merge
      const merged = (updated?.revisions ?? data?.revisions ?? []).find(
        (r) => r.id === revisionId,
      );
      updateUrl(merged ?? null);
    },
    [apiCall, mutateRevisions, constantMutate, data?.revisions, updateUrl],
  );

  const handleDiscard = useCallback(
    async (revisionId: string) => {
      await apiCall(`/revision/${revisionId}/close`, { method: "POST" });
      await mutateRevisions();
      updateUrl(null);
    },
    [apiCall, mutateRevisions, updateUrl],
  );

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

  const userOpenRevision = useMemo(
    () => openRevisions.find((f) => f.authorId === userId) ?? null,
    [openRevisions, userId],
  );

  const hasRealRevisions =
    data !== undefined && (data.revisions?.length ?? 0) > 0;

  // When no real revisions exist yet, synthesize a "Revision 1" representing
  // the initial saved state. Frontend-only, never persisted.
  const syntheticInitialRevision = useMemo((): Revision | null => {
    if (!constant || !data || data.revisions.length > 0) return null;
    return {
      id: "__initial__",
      authorId: constant.owner,
      version: 1,
      title: "Revision 1",
      target: {
        type: entityType,
        id: constant.id,
        snapshot: constant,
        proposedChanges: [] as JsonPatchOperation[],
      },
      status: "merged" as const,
      reviews: [],
      activityLog: [
        {
          id: "initial",
          userId: constant.owner,
          action: "created" as const,
          dateCreated: constant.dateCreated,
        },
      ],
      resolution: {
        action: "merged" as const,
        userId: constant.owner,
        dateCreated: constant.dateCreated,
      },
      dateCreated: constant.dateCreated,
      dateUpdated: constant.dateUpdated,
      organization: constant.organization,
    } as Revision;
  }, [data, constant, entityType]);

  const allRevisions = useMemo(
    () =>
      syntheticInitialRevision
        ? [syntheticInitialRevision]
        : (data?.revisions ?? []),
    [syntheticInitialRevision, data?.revisions],
  );

  return {
    selectedRevision,
    selectedRevisionId,
    openRevisions,
    allRevisions,
    hasRealRevisions,
    selectRevision,
    onRevisionCreated,
    handlePublish,
    handleDiscard,
    handleReopen,
    mutateRevisions,
    userOpenRevision,
  };
}

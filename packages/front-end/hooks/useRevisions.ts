import { RevisionTargetType, Revision } from "shared/enterprise";
import { useUser } from "@/services/UserContext";
import useApi from "./useApi";

type RevisionListOptions = {
  // Comma-separated status list, or the alias "open" for non-merged/non-discarded.
  status?: string;
  limit?: number;
  offset?: number;
};

function buildQueryString(opts: RevisionListOptions): string {
  const params = new URLSearchParams();
  if (opts.status) params.set("status", opts.status);
  if (opts.limit != null) params.set("limit", String(opts.limit));
  if (opts.offset != null) params.set("offset", String(opts.offset));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function useRevisions(opts: RevisionListOptions = {}) {
  const { data, error, mutate } = useApi<{
    revisions: Revision[];
    total: number;
    limit: number;
    offset: number;
  }>(`/revision${buildQueryString(opts)}`);

  return {
    revisions: data?.revisions || [],
    total: data?.total ?? 0,
    isLoading: !error && !data,
    error,
    mutate,
  };
}

/**
 * Lightweight count of open revisions (non-merged/non-discarded), optionally
 * scoped to an entity type. Used by the top-nav badge so it doesn't have to
 * fetch full revision documents.
 */
export function useOpenRevisionCount(entityType?: RevisionTargetType) {
  const qs = entityType ? `?entityType=${entityType}` : "";
  const { orgSuspended, organization } = useUser();
  const { data, error, mutate } = useApi<{ count: number }>(
    `/revision/count${qs}`,
    { shouldRun: () => !orgSuspended && !!organization?.id },
  );
  return {
    count: data?.count ?? 0,
    isLoading: !error && !data,
    error,
    mutate,
  };
}

export function useRevisionsEntityType(
  entityType: RevisionTargetType,
  opts: RevisionListOptions = {},
) {
  const { data, error, mutate } = useApi<{
    revisions: Revision[];
    total: number;
    limit: number;
    offset: number;
  }>(`/revision/entity/${entityType}${buildQueryString(opts)}`);

  return {
    revisions: data?.revisions || [],
    total: data?.total ?? 0,
    isLoading: !error && !data,
    error,
    mutate,
  };
}

export function useRevisionsEntityId(
  entityType: RevisionTargetType,
  entityId: string,
) {
  const { data, error, mutate } = useApi<{
    revisions: Revision[];
  }>(`/revision/entity/${entityType}/${entityId}`);
  return {
    revisions: data?.revisions || [],
    isLoading: !error && !data,
    error,
    mutate,
  };
}
export function useRevision(revisionId: string) {
  const { data, error, mutate } = useApi<{
    revision: Revision;
  }>(`/revision/${revisionId}`);

  return {
    revision: data?.revision,
    isLoading: !error && !data,
    error,
    mutate,
  };
}

export function useRevisionHistory(
  entityType: RevisionTargetType,
  entityId: string,
) {
  const { data, error, mutate } = useApi<{
    revisions: Revision[];
  }>(`/revision/entity/${entityType}/${entityId}/history`);

  return {
    revisions: data?.revisions || [],
    isLoading: !error && !data,
    error,
    mutate,
  };
}

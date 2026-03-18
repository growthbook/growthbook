import { RevisionTargetType, Revision } from "shared/enterprise";
import useApi from "./useApi";

export function useRevisions() {
  const { data, error, mutate } = useApi<{
    revisions: Revision[];
  }>(`/revision`);

  return {
    revisions: data?.revisions || [],
    isLoading: !error && !data,
    error,
    mutate,
  };
}

export function useRevisionsEntityType(entityType: RevisionTargetType) {
  const { data, error, mutate } = useApi<{
    revisions: Revision[];
  }>(`/revision/entity/${entityType}`);

  return {
    revisions: data?.revisions || [],
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

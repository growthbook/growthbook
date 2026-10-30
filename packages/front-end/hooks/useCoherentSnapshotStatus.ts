import { useEffect, useRef, useState } from "react";

export type SnapshotStatusLike = { id: string; status: string };
export type DatedSnapshotStatusLike = SnapshotStatusLike & {
  dateCreated: string;
};

export function newestSnapshotStatus<S extends DatedSnapshotStatusLike>(
  statusLatest: S | null | undefined,
  heavyLatest: S | null | undefined,
): S | null | undefined {
  if (!statusLatest) return heavyLatest;
  if (!heavyLatest) return statusLatest;
  return heavyLatest.dateCreated > statusLatest.dateCreated
    ? heavyLatest
    : statusLatest;
}

// Refetch results when polling discovers a newer successful run.
export function useRefetchHeavyOnStatusSuccess(
  statusLatest: SnapshotStatusLike | null | undefined,
  heavyCaughtUp: boolean,
  heavyIsValidating: boolean,
  refetchHeavy: () => Promise<unknown>,
): void {
  const successStatusId =
    statusLatest?.status === "success" ? statusLatest.id : undefined;
  const refetchedForStatusId = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (successStatusId === undefined) return;
    // Avoid duplicating the heavy request already in flight on initial load.
    if (heavyIsValidating) return;
    if (heavyCaughtUp) {
      refetchedForStatusId.current = undefined;
      return;
    }
    if (refetchedForStatusId.current === successStatusId) return;
    refetchedForStatusId.current = successStatusId;
    void refetchHeavy();
  }, [successStatusId, heavyCaughtUp, heavyIsValidating, refetchHeavy]);
}

// Hold a success status until its results arrive; other statuses pass through.
export function useCoherentLatest<S extends SnapshotStatusLike>(
  statusLatest: S | null | undefined,
  heavyCaughtUp: boolean,
): S | null | undefined {
  const heavyAgrees =
    !statusLatest || statusLatest.status !== "success" || heavyCaughtUp;
  const [held, setHeld] = useState<S | null | undefined>(undefined);
  useEffect(() => {
    if (!heavyAgrees) return;
    setHeld((prev) =>
      prev?.id === statusLatest?.id && prev?.status === statusLatest?.status
        ? prev
        : statusLatest,
    );
  }, [heavyAgrees, statusLatest]);
  return heavyAgrees ? statusLatest : held;
}

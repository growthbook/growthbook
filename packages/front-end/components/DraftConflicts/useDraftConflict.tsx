import { useCallback, useRef, useState } from "react";
import { UseFormReturn } from "react-hook-form";
import { DraftConflict } from "shared/types/draft-conflict";
import HelperText from "@/ui/HelperText";
import {
  ConflictCalloutRow,
  ConflictResolution,
  ContestedChunk,
  WholeConflictCallout,
} from "@/components/DraftConflicts/ConflictContext";
import { formatChunkValue } from "@/components/DraftConflicts/conflictValues";

const WHOLE_KEY = "__entity__";

type Conflict<T> = DraftConflict<T> & {
  baseAtConflict: T;
  // Frozen, so "You set …" survives a resolution overwriting the form.
  attempted: T;
};

/**
 * The client half of the draft-conflict guard, shared by every draft-powered
 * modal: what to send, what to do with a 409, and the UI for resolving it.
 */
export function useDraftConflict<T extends object>({
  initial,
  labels,
  form,
  applyField,
  isNewDraft,
  entityNoun,
  onReload,
}: {
  initial: T;
  labels?: Record<string, string>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form?: UseFormReturn<any>;
  // For editors that aren't react-hook-form backed (e.g. a set of toggles).
  applyField?: (field: string, value: unknown) => void;
  isNewDraft: boolean;
  entityNoun: string;
  // Offered in place of merge choices when a contested value was too large to ship.
  onReload?: () => void;
}) {
  const [baseline, setBaseline] = useState<T>(initial);
  const [conflict, setConflict] = useState<Conflict<T> | null>(null);
  const [resolutions, setResolutions] = useState<
    Map<string, ConflictResolution>
  >(new Map());
  const [claimed, setClaimed] = useState<Set<string>>(new Set());
  const minesRef = useRef<Map<string, Record<string, unknown>>>(new Map());
  const signaledRef = useRef(false);
  // Editors that seed their own state from a prop (the condition builder) need
  // a remount to show an applied value.
  const [renderKey, setRenderKey] = useState(0);

  const claim = useCallback((key: string) => {
    setClaimed((s) => (s.has(key) ? s : new Set(s).add(key)));
  }, []);
  const release = useCallback((key: string) => {
    setClaimed((s) => {
      if (!s.has(key)) return s;
      const next = new Set(s);
      next.delete(key);
      return next;
    });
  }, []);

  const setField = useCallback(
    (field: string, value: unknown) => {
      if (applyField) {
        applyField(field, value);
        return;
      }
      if (!form) return;
      form.setValue(field, value, { shouldDirty: true });
    },
    [form, applyField],
  );

  const resolve = useCallback(
    (chunk: ContestedChunk, choice: ConflictResolution) => {
      if (!conflict) return;
      const current = conflict.current as unknown as Record<string, unknown>;
      const stash = minesRef.current;
      if (choice === "theirs" && !stash.has(chunk.key)) {
        const mine = conflict.attempted as unknown as Record<string, unknown>;
        stash.set(
          chunk.key,
          Object.fromEntries(chunk.fields.map((f) => [f, mine[f]])),
        );
      }
      const source = choice === "theirs" ? current : stash.get(chunk.key);
      if (source) {
        for (const f of chunk.fields) setField(f, source[f]);
        setRenderKey((k) => k + 1);
      }
      setResolutions((m) => new Map([...m, [chunk.key, choice]]));
    },
    [conflict, setField],
  );

  const format = useCallback(
    (chunk: ContestedChunk, side: ConflictResolution) =>
      formatChunkValue(
        (side === "theirs" ? conflict?.current : conflict?.attempted) as Record<
          string,
          unknown
        > | null,
        chunk.fields,
      ),
    [conflict],
  );

  const labelFor = useCallback(
    (chunk: ContestedChunk) => labels?.[chunk.key] ?? chunk.key,
    [labels],
  );

  const contested: ContestedChunk[] =
    conflict?.merge && !conflict.merge.wholeEntity && conflict.current
      ? conflict.merge.contested
      : [];
  const keysToResolve = conflict
    ? contested.length
      ? contested.map((c) => c.key)
      : [WHOLE_KEY]
    : [];
  // Forking only keeps both versions when their edit is in another draft. Against
  // live, the new draft carries this stale edit on top of their published change.
  const newDraftAvoidsConflict =
    isNewDraft && conflict?.draftVersion !== undefined;
  const resolved =
    !conflict ||
    newDraftAvoidsConflict ||
    keysToResolve.every((k) => resolutions.has(k));

  /** Per-submit: the baseline to send, and the 409 handler. */
  const guard = useCallback(
    (attempted: T) => ({
      // A fork compares against live, which only the pre-conflict baseline describes.
      baseline:
        newDraftAvoidsConflict && conflict ? conflict.baseAtConflict : baseline,
      onError: (responseData: { status?: number; conflict?: unknown }) => {
        if (responseData?.status !== 409 || !responseData?.conflict) return;
        signaledRef.current = true;
        const payload = responseData.conflict as DraftConflict<T>;
        setConflict({ ...payload, baseAtConflict: baseline, attempted });
        setResolutions(new Map());
        minesRef.current = new Map();
        if (payload.merge && !payload.merge.wholeEntity && payload.current) {
          const cur = payload.current as unknown as Record<string, unknown>;
          for (const f of payload.merge.theirFields) setField(f, cur[f]);
          setRenderKey((k) => k + 1);
        }
        if (payload.current) setBaseline(payload.current);
      },
    }),
    [baseline, setField, conflict, newDraftAvoidsConflict],
  );

  // The conflict renders its own banner, so a handled 409 must not also surface
  // the request error. An empty message renders nothing.
  const guarded = useCallback(async <R,>(call: () => Promise<R>) => {
    signaledRef.current = false;
    try {
      return await call();
    } catch (e) {
      if (signaledRef.current) {
        signaledRef.current = false;
        throw new Error("");
      }
      throw e;
    }
  }, []);

  const onReloadRef = useRef(onReload);
  onReloadRef.current = onReload;
  const reload = useCallback(() => {
    setConflict(null);
    onReloadRef.current?.();
  }, []);

  // Page-mounted hooks re-pin at modal open; the initial baseline predates it.
  const clear = useCallback((fresh?: T) => {
    setConflict(null);
    if (fresh) setBaseline(fresh);
  }, []);

  const alert = conflict ? (
    <HelperText status="warning" icon={null}>
      {!conflict.current
        ? `This ${entityNoun} was removed while you had it open. Saving re-adds it.`
        : newDraftAvoidsConflict
          ? `This ${entityNoun} was modified while you were editing. Saving to a new draft keeps both versions.`
          : resolved
            ? `This ${entityNoun} was modified while you were editing.`
            : isNewDraft
              ? `This ${entityNoun} was modified while you were editing. Resolve the conflicts below.`
              : `This ${entityNoun} was modified while you were editing. Resolve the conflicts below, or save to a new draft.`}
    </HelperText>
  ) : undefined;

  const callouts =
    conflict && !newDraftAvoidsConflict ? (
      contested.length ? (
        contested
          .filter((c) => !claimed.has(c.key))
          .map((chunk) => (
            <ConflictCalloutRow
              chunk={chunk}
              showMine
              stateful
              key={chunk.key}
            />
          ))
      ) : (
        <WholeConflictCallout
          chunkKey={WHOLE_KEY}
          message={
            conflict.current
              ? `This ${entityNoun} was restructured by someone else. Saving keeps your version.`
              : `This ${entityNoun} was deleted by someone else. Saving re-adds it.`
          }
        />
      )
    ) : null;

  return {
    guard,
    guarded,
    renderKey,
    clear,
    resolved,
    alert,
    alertActive: !resolved,
    callouts,
    hasConflict: !!conflict,
    conflictFromDraft: conflict?.draftVersion !== undefined,
    providerProps: {
      contested: newDraftAvoidsConflict ? [] : contested,
      resolutions,
      resolve,
      format,
      labelFor,
      claimed,
      claim,
      release,
      omitted: conflict?.omittedFields,
      reload: onReload ? reload : undefined,
    },
  };
}

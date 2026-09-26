import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import type {
  ExperimentChangesBody,
  ExperimentChangesFields,
  ExperimentRuleEnvironments,
} from "shared/validators";
import { useAuth } from "@/services/auth";

type PendingEdit = {
  /** Puts the field back to what is stored. */
  discard: () => void;
  /** Runs once the edit has been written. */
  onSaved?: () => void;
} & (
  | {
      /** This edit's share of the one changeset the page saves. */
      changes: () => ExperimentChangesBody;
      save?: never;
    }
  | {
      /** Writes through its own endpoint, after the changeset. Rejects to leave the bar up. */
      save: () => Promise<void>;
      changes?: never;
    }
);

interface ExperimentEditsValue {
  /** Anything on the page edited but not yet written. */
  dirty: boolean;
  saving: boolean;
  error: string | null;
  saveAll: () => Promise<void>;
  discardAll: () => void;
  register: (id: string, edit: PendingEdit | null) => void;
}

const ExperimentEditsContext = createContext<ExperimentEditsValue | null>(null);

function mergeChanges(parts: ExperimentChangesBody[]): ExperimentChangesBody {
  const body: ExperimentChangesBody = {};
  for (const part of parts) {
    if (part.experiment) {
      body.experiment = {
        changes: { ...body.experiment?.changes, ...part.experiment.changes },
        base: { ...body.experiment?.base, ...part.experiment.base },
      };
    }
    if (part.flagValues) {
      body.flagValues = [...(body.flagValues ?? []), ...part.flagValues];
    }
  }
  return body;
}

/**
 * An experiment-field edit, with the value each field held when loaded so a
 * save over someone else's change fails instead of overwriting it.
 */
export function experimentFieldChanges(
  experiment: ExperimentInterfaceStringDates,
  changes: ExperimentChangesFields,
): ExperimentChangesBody {
  const base: Record<string, unknown> = {};
  for (const key of Object.keys(changes)) {
    base[key] =
      key === "variationWeights"
        ? (experiment.phases[experiment.phases.length - 1]?.variationWeights ??
          null)
        : (experiment[key as keyof ExperimentInterfaceStringDates] ?? null);
  }
  return { experiment: { changes, base } };
}

/**
 * Collects the page's in-place edits so one Save writes them together, rather
 * than every field posting the moment it loses focus.
 */
export function ExperimentEditsProvider({
  experimentId,
  mutate,
  children,
}: {
  experimentId: string;
  mutate: () => void;
  children: ReactNode;
}) {
  const { apiCall } = useAuth();
  const edits = useRef(new Map<string, PendingEdit>());
  const [dirtyIds, setDirtyIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const register = useCallback((id: string, edit: PendingEdit | null) => {
    if (edit) edits.current.set(id, edit);
    else edits.current.delete(id);
    setDirtyIds((prev) => {
      const has = prev.includes(id);
      if (edit && !has) return [...prev, id];
      if (!edit && has) return prev.filter((x) => x !== id);
      return prev;
    });
  }, []);

  const saveAll = useCallback(async () => {
    setSaving(true);
    setError(null);
    const pending = [...edits.current.values()];
    // A refused save keeps the page's loaded base, so a retry can't quietly
    // overwrite the change that refused it.
    let wrote = false;
    try {
      const inChangeset = pending.filter((edit) => edit.changes);
      if (inChangeset.length) {
        await apiCall(`/experiment/${experimentId}/changes`, {
          method: "POST",
          body: JSON.stringify(
            mergeChanges(inChangeset.map((edit) => edit.changes?.() ?? {})),
          ),
        });
        wrote = true;
        inChangeset.forEach((edit) => edit.onSaved?.());
      }
      // Sequential: these hit the same document, and a parallel write would
      // race the last one to land.
      for (const edit of pending) {
        if (!edit.save) continue;
        await edit.save();
        wrote = true;
        edit.onSaved?.();
      }
    } catch (e) {
      setError(e.message || "Could not save your changes");
    } finally {
      setSaving(false);
      if (wrote) mutate();
    }
  }, [apiCall, experimentId, mutate]);

  const discardAll = useCallback(() => {
    [...edits.current.values()].forEach((edit) => edit.discard());
    setError(null);
  }, []);

  const value = useMemo(
    () => ({
      dirty: dirtyIds.length > 0,
      saving,
      error,
      saveAll,
      discardAll,
      register,
    }),
    [dirtyIds, saving, error, saveAll, discardAll, register],
  );

  return (
    <ExperimentEditsContext.Provider value={value}>
      {children}
    </ExperimentEditsContext.Provider>
  );
}

export function useExperimentEdits() {
  return useContext(ExperimentEditsContext);
}

/**
 * Hands the page a field's pending change. Pass `dirty` false once it matches
 * what is stored, and the field drops out of the pending set.
 */
export function useRegisterExperimentEdit(
  id: string,
  dirty: boolean,
  edit: PendingEdit,
) {
  const ctx = useContext(ExperimentEditsContext);
  const latest = useRef(edit);
  latest.current = edit;

  const inChangeset = !!edit.changes;
  useEffect(() => {
    if (!ctx) return;
    const discard = () => latest.current.discard();
    const onSaved = () => latest.current.onSaved?.();
    ctx.register(
      id,
      !dirty
        ? null
        : inChangeset
          ? {
              changes: () => latest.current.changes?.() ?? {},
              discard,
              onSaved,
            }
          : {
              save: () => latest.current.save?.() ?? Promise.resolve(),
              discard,
              onSaved,
            },
    );
  }, [ctx, id, dirty, inChangeset]);

  useEffect(() => {
    return () => ctx?.register(id, null);
  }, [ctx, id]);
}

export const EDITS_BLOCKED_REASON =
  "Finish your current edits — save or discard them — before changing these values";

/**
 * Why another editing surface cannot open yet, or null when it can. Controls
 * that would open one disable themselves and say so, rather than opening a
 * second draft over the page's own.
 */
export function useEditsBlockedReason(): string | null {
  const ctx = useContext(ExperimentEditsContext);
  return ctx?.dirty ? EDITS_BLOCKED_REASON : null;
}

/** Environment scopes staged per Feature Flag, saved with that flag's values. */
export interface FlagEnvironmentsDraft {
  value: Record<string, ExperimentRuleEnvironments>;
  set: (featureId: string, scope: ExperimentRuleEnvironments | null) => void;
}

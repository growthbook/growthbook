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

interface PendingEdit {
  /** Writes the field's value. Rejects to leave the bar up. */
  save: () => Promise<void>;
  /** Puts the field back to what is stored. */
  discard: () => void;
}

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

/**
 * Collects the page's in-place edits so one Save writes them together, rather
 * than every field posting the moment it loses focus.
 */
export function ExperimentEditsProvider({ children }: { children: ReactNode }) {
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
    try {
      // Sequential: these hit the same document, and a parallel write would
      // race the last one to land.
      for (const edit of [...edits.current.values()]) {
        await edit.save();
      }
    } catch (e) {
      setError(e.message || "Could not save your changes");
    } finally {
      setSaving(false);
    }
  }, []);

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

  useEffect(() => {
    if (!ctx) return;
    ctx.register(
      id,
      dirty
        ? {
            save: () => latest.current.save(),
            discard: () => latest.current.discard(),
          }
        : null,
    );
  }, [ctx, id, dirty]);

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

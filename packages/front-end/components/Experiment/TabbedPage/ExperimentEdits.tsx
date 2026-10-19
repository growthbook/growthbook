import {
  createContext,
  Dispatch,
  ReactNode,
  SetStateAction,
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
import useUnsavedChangesGuard from "@/hooks/useUnsavedChangesGuard";
import ConfirmDialog from "@/ui/ConfirmDialog";
import { mergeChanges } from "./mergeChanges";

type PendingEdit = {
  /** Puts the field back to what is stored. */
  discard: () => void;
  /** Runs once the edit has been written. */
  onSaved?: () => void;
} & (
  | {
      /**
       * This edit's share of the one changeset the page saves. A dry run
       * builds the same share without staging anything on the page.
       */
      changes: (options: { dryRun: boolean }) => ExperimentChangesBody;
      save?: never;
    }
  | {
      /** Writes through its own endpoint, after the changeset. Rejects to leave the bar up. */
      save: () => Promise<void>;
      changes?: never;
    }
);

interface ExperimentEditsValue {
  scope: string;
  /** Anything on the page edited but not yet written. */
  dirty: boolean;
  saving: boolean;
  error: string | null;
  saveAll: () => Promise<void>;
  discardAll: () => void;
  register: (id: string, edit: PendingEdit | null) => void;
  checkChanges: CheckChanges;
  allowUnload: () => void;
}

/**
 * Runs the save's checks, writing nothing, with `part` standing in for edit
 * `id`'s share. Rejects with the reason the save would be refused.
 */
type CheckChanges = (id: string, part: ExperimentChangesBody) => Promise<void>;

const ExperimentEditsContext = createContext<ExperimentEditsValue | null>(null);

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
      key === "variationWeights" || key === "coverage"
        ? (experiment.phases[experiment.phases.length - 1]?.[key] ?? null)
        : (experiment[key as keyof ExperimentInterfaceStringDates] ?? null);
  }
  return { experiment: { changes, base } };
}

const STAGED_EDITS_PREFIX = "gb-experiment-edits";

export function stagedEditsScope(
  experiment: Pick<ExperimentInterfaceStringDates, "id" | "status">,
): string {
  return `${experiment.id}:${experiment.status}`;
}

function readStaged<T>(key: string | null, initial: T): T {
  if (!key) return initial;
  try {
    const stored = sessionStorage.getItem(key);
    return stored === null ? initial : (JSON.parse(stored) as T);
  } catch {
    return initial;
  }
}

function clearStagedEdits(scope: string) {
  try {
    const prefix = `${STAGED_EDITS_PREFIX}:${scope}:`;
    const keys = Array.from({ length: sessionStorage.length }, (_, i) =>
      sessionStorage.key(i),
    );
    keys.forEach((key) => {
      if (key?.startsWith(prefix)) sessionStorage.removeItem(key);
    });
  } catch {
    return;
  }
}

export function useStagedState<T>(
  slot: string,
  initial: T,
  scope?: string | null,
): [T, Dispatch<SetStateAction<T>>] {
  const providerScope = useContext(ExperimentEditsContext)?.scope ?? null;
  const resolvedScope = scope === undefined ? providerScope : scope;
  const key = resolvedScope
    ? `${STAGED_EDITS_PREFIX}:${resolvedScope}:${slot}`
    : null;
  const [state, setState] = useState(() => ({
    key,
    value: readStaged(key, initial),
  }));
  let current = state;
  if (state.key !== key) {
    current = { key, value: readStaged(key, initial) };
    setState(current);
  }

  const initialJson = JSON.stringify(initial);
  useEffect(() => {
    if (!current.key) return;
    try {
      const json = JSON.stringify(current.value);
      if (json === initialJson) sessionStorage.removeItem(current.key);
      else sessionStorage.setItem(current.key, json);
    } catch {
      return;
    }
  }, [current.key, current.value, initialJson]);

  const set: Dispatch<SetStateAction<T>> = useCallback(
    (next) =>
      setState((prev) => ({
        key: prev.key,
        value:
          typeof next === "function"
            ? (next as (prev: T) => T)(prev.value)
            : next,
      })),
    [],
  );
  return [current.value, set];
}

/**
 * Collects the page's in-place edits so one Save writes them together, rather
 * than every field posting the moment it loses focus.
 */
export function ExperimentEditsProvider({
  experimentId,
  scope,
  mutate,
  children,
}: {
  experimentId: string;
  scope: string;
  mutate: () => void;
  children: ReactNode;
}) {
  const { apiCall } = useAuth();
  const edits = useRef(new Map<string, PendingEdit>());

  const previousScope = useRef(scope);
  useEffect(() => {
    const left = previousScope.current;
    previousScope.current = scope;
    if (left === scope || !left.startsWith(`${experimentId}:`)) return;
    clearStagedEdits(left);
  }, [scope, experimentId]);
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
            mergeChanges(
              inChangeset.map(
                (edit) => edit.changes?.({ dryRun: false }) ?? {},
              ),
            ),
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

  const checkChanges: CheckChanges = useCallback(
    async (id, part) => {
      const parts: ExperimentChangesBody[] = [];
      for (const [editId, edit] of edits.current) {
        if (editId === id || !edit.changes) continue;
        // One that can't build its share yet is the save's to report.
        try {
          parts.push(edit.changes({ dryRun: true }));
        } catch {
          continue;
        }
      }
      await apiCall(`/experiment/${experimentId}/changes`, {
        method: "POST",
        body: JSON.stringify({
          ...mergeChanges([...parts, part]),
          dryRun: true,
        }),
      });
    },
    [apiCall, experimentId],
  );

  // Discards before leaving: a route change started with edits still staged
  // doesn't complete until they're saved or discarded.
  const navigationGuard = useUnsavedChangesGuard(
    dirtyIds.length > 0,
    discardAll,
  );

  const { allowUnload } = navigationGuard;
  const value = useMemo(
    () => ({
      scope,
      dirty: dirtyIds.length > 0,
      saving,
      error,
      saveAll,
      discardAll,
      register,
      checkChanges,
      allowUnload,
    }),
    [
      scope,
      dirtyIds,
      saving,
      error,
      saveAll,
      discardAll,
      register,
      checkChanges,
      allowUnload,
    ],
  );

  return (
    <ExperimentEditsContext.Provider value={value}>
      {children}
      {navigationGuard.pendingHref ? (
        <ConfirmDialog
          title="Leave without saving?"
          content="You have unsaved changes to this experiment. Leaving this page discards them."
          yesText="Leave page"
          noText="Keep editing"
          onConfirm={navigationGuard.confirmNavigation}
          onCancel={navigationGuard.cancelNavigation}
        />
      ) : null}
    </ExperimentEditsContext.Provider>
  );
}

export function useExperimentEdits() {
  return useContext(ExperimentEditsContext);
}

/** Null outside the page's provider, where there's no save to check. */
export function useCheckExperimentChanges(): CheckChanges | null {
  return useContext(ExperimentEditsContext)?.checkChanges ?? null;
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
              changes: (options) => latest.current.changes?.(options) ?? {},
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

/** Why a control waits on the page's staged edits, or null when none are. */
export function useEditsBlockedReason(): string | null {
  const ctx = useContext(ExperimentEditsContext);
  return ctx?.dirty ? "Save or discard your changes first." : null;
}

/** A holdout staged for the page's Save: an id to join, "" to leave, null for none staged. */
export interface HoldoutDraft {
  value: string | null;
  set: (value: string | null) => void;
}

/** Environment scopes staged per Feature Flag, saved with that flag's values. */
export interface FlagEnvironmentsDraft {
  value: Record<string, ExperimentRuleEnvironments>;
  set: (featureId: string, scope: ExperimentRuleEnvironments | null) => void;
}

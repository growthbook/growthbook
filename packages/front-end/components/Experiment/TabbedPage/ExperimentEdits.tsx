import {
  createContext,
  Dispatch,
  ReactNode,
  SetStateAction,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import {
  apiErrorRegistry,
  type ApiErrorDetails,
  type ExperimentChangesBody,
  type ExperimentChangesFields,
  type ExperimentRuleEnvironments,
} from "shared/validators";
import { useAuth } from "@/services/auth";
import { ApiCallError } from "@/services/apiCallError";
import useUnsavedChangesGuard from "@/hooks/useUnsavedChangesGuard";
import ConfirmDialog from "@/ui/ConfirmDialog";
import { mergeChanges } from "./mergeChanges";

type PendingEdit = {
  /** Names the edit in the save bar's list of staged changes. */
  label: string;
  /**
   * What the edit changes, saved against staged. Edits in the changeset can
   * leave it out: their experiment fields carry the values they replace.
   */
  review?: () => StagedReview;
  /** Puts the field back to what is stored. */
  discard: () => void;
  /** Runs once the edit has been written. */
  onSaved?: () => void;
  /** Takes the page as it is now as what the edit was made against. */
  rebase?: () => void;
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

export type StagedReview = { before: unknown; after: unknown };

// Before and after from an edit's share of the changeset: each experiment
// field against the value it was loaded with, and anything else as added.
function reviewFromChanges(body: ExperimentChangesBody): StagedReview {
  const { experiment, ...rest } = body;
  return {
    before: experiment?.base ?? {},
    after: { ...experiment?.changes, ...rest },
  };
}

// One that can't build its share yet is the save's to report.
function dryRunShare(edit: PendingEdit): ExperimentChangesBody | null {
  try {
    return edit.changes?.({ dryRun: true }) ?? null;
  } catch {
    return null;
  }
}

interface ExperimentEditsValue {
  scope: string;
  /** Anything on the page edited but not yet written. */
  dirty: boolean;
  saving: boolean;
  error: string | null;
  /**
   * Set once a save is refused for a rule that applies everywhere; acknowledging
   * lets the next save, and its checks, write it anyway.
   */
  unscopedRule: {
    message: string;
    acknowledged: boolean;
    acknowledge: (acknowledged: boolean) => void;
  } | null;
  saveAll: () => Promise<void>;
  /**
   * The form a staged field joins through its `form` attribute, so a value its
   * own constraints refuse stops the save.
   */
  formId: string;
  discardAll: () => void;
  /** The staged edits, in the order they were made. */
  staged: { id: string; label: string }[];
  /** Staged edits whose fields someone else saved since they were made. */
  conflicts: string[];
  /** Saves this edit over the other change next time. */
  keepMine: (id: string) => void;
  discard: (id: string) => void;
  review: (id: string) => StagedReview | null;
  register: (id: string, edit: PendingEdit | null) => void;
  checkChanges: CheckChanges;
  /** Runs the save's checks on everything staged, writing nothing. */
  checkAll: () => Promise<void>;
  allowUnload: () => void;
}

/**
 * Runs the save's checks, writing nothing, with `part` standing in for edit
 * `id`'s share. Rejects with the reason the save would be refused.
 */
type CheckChanges = (id: string, part: ExperimentChangesBody) => Promise<void>;

const ExperimentEditsContext = createContext<ExperimentEditsValue | null>(null);

const INVALID_FIELDS = "Fill in the highlighted fields to save.";
const CONFLICT =
  "Someone else saved changes to what you edited. Keep yours or discard them, then save again.";

type ChangesConflict = ApiErrorDetails<"changes_conflict">;

/** Thrown by an edit that saves itself when what it changed was saved by someone else. */
export class StagedEditConflict extends Error {}

function changesConflict(e: unknown): ChangesConflict | null {
  if (!(e instanceof ApiCallError) || e.code !== "changes_conflict") {
    return null;
  }
  const parsed = apiErrorRegistry.changes_conflict.detailsSchema.safeParse(
    e.details,
  );
  return parsed.success ? parsed.data : null;
}

function touches(
  share: ExperimentChangesBody | null,
  { fields, featureIds }: ChangesConflict,
): boolean {
  return (
    Object.keys(share?.experiment?.changes ?? {}).some((key) =>
      fields.includes(key),
    ) || !!share?.flagValues?.some((f) => featureIds.includes(f.featureId))
  );
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
  mutate: () => unknown;
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
  const [staged, setStaged] = useState<{ id: string; label: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unscopedRefusal, setUnscopedRefusal] = useState<string | null>(null);
  const [allowUnscopedRules, setAllowUnscopedRules] = useState(false);
  const [conflicts, setConflicts] = useState<string[]>([]);
  const formId = useId();
  const form = useRef<HTMLFormElement>(null);

  const register = useCallback((id: string, edit: PendingEdit | null) => {
    if (edit) edits.current.set(id, edit);
    else edits.current.delete(id);
    setStaged((prev) => {
      const i = prev.findIndex((entry) => entry.id === id);
      if (!edit)
        return i === -1 ? prev : prev.filter((entry) => entry.id !== id);
      if (i === -1) return [...prev, { id, label: edit.label }];
      if (prev[i].label === edit.label) return prev;
      return prev.map((entry, j) =>
        j === i ? { id, label: edit.label } : entry,
      );
    });
  }, []);

  const saveAll = useCallback(async () => {
    // The browser says which field and why, and takes the writer there.
    if (form.current && !form.current.reportValidity()) {
      setError(INVALID_FIELDS);
      return;
    }
    setSaving(true);
    setError(null);
    setConflicts([]);
    const pending = [...edits.current.entries()];
    // A refused save keeps each edit's base, so a retry can't quietly
    // overwrite the change that refused it.
    const saved: PendingEdit[] = [];
    let refetch = false;
    try {
      const inChangeset = pending.filter(([, edit]) => edit.changes);
      if (inChangeset.length) {
        try {
          await apiCall(`/experiment/${experimentId}/changes`, {
            method: "POST",
            body: JSON.stringify({
              ...mergeChanges(
                inChangeset.map(
                  ([, edit]) => edit.changes?.({ dryRun: false }) ?? {},
                ),
              ),
              ...(allowUnscopedRules && { allowUnscopedRules: true }),
            }),
          });
        } catch (e) {
          const conflict = changesConflict(e);
          if (!conflict) throw e;
          // Refetched, so keeping an edit takes what was saved as its base.
          refetch = true;
          setConflicts(
            inChangeset
              .filter(([, edit]) => touches(dryRunShare(edit), conflict))
              .map(([id]) => id),
          );
          throw new Error(CONFLICT);
        }
        saved.push(...inChangeset.map(([, edit]) => edit));
      }
      // Sequential: these hit the same document, and a parallel write would
      // race the last one to land.
      for (const [id, edit] of pending) {
        if (!edit.save) continue;
        try {
          await edit.save();
        } catch (e) {
          if (!(e instanceof StagedEditConflict)) throw e;
          setConflicts((prev) => [...prev, id]);
          throw new Error(CONFLICT);
        }
        saved.push(edit);
      }
      setUnscopedRefusal(null);
      setAllowUnscopedRules(false);
    } catch (e) {
      const message = e.message || "Could not save your changes";
      if (e instanceof ApiCallError && e.code === "unscoped_rule") {
        setUnscopedRefusal(message);
      } else {
        setError(message);
      }
    } finally {
      // Cleared once the refetch lands, so the page never shows the old values.
      if (saved.length || refetch) await mutate();
      saved.forEach((edit) => edit.onSaved?.());
      setSaving(false);
    }
  }, [apiCall, experimentId, mutate, allowUnscopedRules]);

  // Its fields' input doesn't bubble to it, since they aren't inside it.
  useEffect(() => {
    const onInput = (e: Event) => {
      const el = form.current;
      if (!el || (e.target as HTMLInputElement).form !== el) return;
      if (el.checkValidity()) {
        setError((prev) => (prev === INVALID_FIELDS ? null : prev));
      }
    };
    document.addEventListener("input", onInput);
    return () => document.removeEventListener("input", onInput);
  }, []);

  const discardAll = useCallback(() => {
    [...edits.current.values()].forEach((edit) => edit.discard());
    setError(null);
    setConflicts([]);
    setUnscopedRefusal(null);
    setAllowUnscopedRules(false);
  }, []);

  const resolve = useCallback((id: string) => {
    setConflicts((prev) => prev.filter((c) => c !== id));
  }, []);
  useEffect(() => {
    if (!conflicts.length) setError((e) => (e === CONFLICT ? null : e));
  }, [conflicts]);
  const discard = useCallback(
    (id: string) => {
      edits.current.get(id)?.discard();
      resolve(id);
    },
    [resolve],
  );
  const keepMine = useCallback(
    (id: string) => {
      edits.current.get(id)?.rebase?.();
      resolve(id);
    },
    [resolve],
  );

  const review = useCallback((id: string): StagedReview | null => {
    const edit = edits.current.get(id);
    if (!edit) return null;
    if (edit.review) return edit.review();
    const share = dryRunShare(edit);
    return share && reviewFromChanges(share);
  }, []);

  // `except`'s share is left out, for a caller standing in its own.
  const dryRun = useCallback(
    async (except: string | null, extra: ExperimentChangesBody[]) => {
      const parts: ExperimentChangesBody[] = [];
      for (const [editId, edit] of edits.current) {
        const share = editId === except ? null : dryRunShare(edit);
        if (share) parts.push(share);
      }
      await apiCall(`/experiment/${experimentId}/changes`, {
        method: "POST",
        body: JSON.stringify({
          ...mergeChanges([...parts, ...extra]),
          ...(allowUnscopedRules && { allowUnscopedRules: true }),
          dryRun: true,
        }),
      });
    },
    [apiCall, experimentId, allowUnscopedRules],
  );
  // Another edit's conflict or empty field is the save's to report, not this one's.
  const checkChanges: CheckChanges = useCallback(
    (id, part) =>
      dryRun(id, [part]).catch((e) => {
        if (!changesConflict(e)) throw e;
      }),
    [dryRun],
  );
  const checkAll = useCallback(async () => {
    if (form.current && !form.current.checkValidity()) {
      throw new Error(INVALID_FIELDS);
    }
    await dryRun(null, []);
  }, [dryRun]);

  // Discards before leaving: a route change started with edits still staged
  // doesn't complete until they're saved or discarded.
  const navigationGuard = useUnsavedChangesGuard(staged.length > 0, discardAll);

  const { allowUnload } = navigationGuard;
  const unscopedRule = useMemo(
    () =>
      unscopedRefusal
        ? {
            message: unscopedRefusal,
            acknowledged: allowUnscopedRules,
            acknowledge: setAllowUnscopedRules,
          }
        : null,
    [unscopedRefusal, allowUnscopedRules],
  );
  const value = useMemo(
    () => ({
      scope,
      dirty: staged.length > 0,
      saving,
      error,
      unscopedRule,
      saveAll,
      formId,
      discardAll,
      staged,
      conflicts,
      keepMine,
      discard,
      review,
      register,
      checkChanges,
      checkAll,
      allowUnload,
    }),
    [
      scope,
      staged,
      conflicts,
      keepMine,
      saving,
      error,
      unscopedRule,
      saveAll,
      formId,
      discardAll,
      discard,
      review,
      register,
      checkChanges,
      checkAll,
      allowUnload,
    ],
  );

  return (
    <ExperimentEditsContext.Provider value={value}>
      {children}
      {/* Never submitted: Save checks it. The disabled default button keeps
          Enter in a field from submitting it. */}
      <form id={formId} ref={form} hidden>
        <button type="submit" disabled />
      </form>
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

/**
 * Hands the page a field's pending change. Pass `dirty` false once it matches
 * what is stored, and the field drops out of the pending set.
 */
export function useRegisterExperimentEdit(
  id: string,
  dirty: boolean,
  edit: PendingEdit,
) {
  // Stable, unlike the context around it, which changes with every staged
  // edit: keyed on that, each change would unregister and re-register them all.
  const register = useContext(ExperimentEditsContext)?.register;
  const latest = useRef(edit);
  latest.current = edit;

  const inChangeset = !!edit.changes;
  const label = edit.label;
  useEffect(() => {
    if (!register) return;
    const discard = () => latest.current.discard();
    const onSaved = () => latest.current.onSaved?.();
    const rebase = () => latest.current.rebase?.();
    const review = latest.current.review
      ? () => latest.current.review?.() ?? { before: null, after: null }
      : undefined;
    register(
      id,
      dirty
        ? {
            label,
            review,
            discard,
            onSaved,
            rebase,
            ...(inChangeset
              ? {
                  changes: (options: { dryRun: boolean }) =>
                    latest.current.changes?.(options) ?? {},
                }
              : {
                  save: () => latest.current.save?.() ?? Promise.resolve(),
                }),
          }
        : null,
    );
  }, [register, id, dirty, inChangeset, label]);

  useEffect(() => {
    return () => register?.(id, null);
  }, [register, id]);
}

/**
 * What an edit was made against, taken when it's first staged and kept, reloads
 * included, until it's saved or discarded. A save compares against it rather
 * than whatever the page has refetched since. `rebase` takes the page as it is now.
 */
export function useEditBase<B>(
  slot: string,
  dirty: boolean,
  snapshot: () => B,
): [B | null, () => void] {
  const [base, setBase] = useStagedState<B | null>(`base:${slot}`, null);
  const latest = useRef(snapshot);
  latest.current = snapshot;
  useEffect(() => {
    if (dirty && base === null) setBase(latest.current());
    if (!dirty && base !== null) setBase(null);
  }, [dirty, base, setBase]);
  const rebase = useCallback(() => setBase(latest.current()), [setBase]);
  return [base, rebase];
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

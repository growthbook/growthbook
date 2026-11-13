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
  useSyncExternalStore,
} from "react";
import isEqual from "lodash/isEqual";
import {
  ExperimentInterfaceStringDates,
  ExperimentTargetingData,
} from "shared/types/experiment";
import { conflictingFields, experimentFieldValue } from "shared/experiments";
import {
  apiErrorRegistry,
  type ApiErrorDetails,
  type ExperimentChangesBody,
  type ExperimentChangesFields,
  type ExperimentRuleEnvironments,
} from "shared/validators";
import { Flex } from "@radix-ui/themes";
import { useAuth } from "@/services/auth";
import { ApiCallError } from "@/services/apiCallError";
import useUnsavedChangesGuard from "@/hooks/useUnsavedChangesGuard";
import ConfirmDialog from "@/ui/ConfirmDialog";
import Text from "@/ui/Text";
import { mergeChanges } from "./mergeChanges";

type PendingEdit = {
  label: string;
  // Made for the experiment's status at the time, as delivery edits are for a
  // draft: once the status moves, it can only be discarded.
  statusBound?: boolean;
  // Without it, the review comes from the edit's share of the changeset.
  review?: () => StagedReview;
  discard: () => void;
  // Defaults to discard: most edits just clear what they staged.
  onSaved?: () => void;
  // Takes the page as it is now as what the edit was made against.
  rebase?: () => void;
  // This edit's share of the one changeset the page saves; a dry run stages
  // nothing on the page.
  changes: (options: { dryRun: boolean }) => ExperimentChangesBody;
};

export type StagedReview = { before: unknown; after: unknown };

// Each experiment field against its value in the share's base; anything else
// counts as added.
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
    return edit.changes({ dryRun: true });
  } catch {
    return null;
  }
}

export type IncompatibleEdit = { id: string; stagedIn: string };

interface ExperimentEditsValue {
  scope: string;
  // As last fetched: staged edits are checked against it as it refreshes.
  experiment: ExperimentInterfaceStringDates;
  dirty: boolean;
  saving: boolean;
  error: string | null;
  // The last save went through, but the page still shows what it replaced.
  refreshFailed: boolean;
  // Set once a save is refused for a rule that applies everywhere;
  // acknowledging lets the next save, and its checks, write it anyway.
  unscopedRule: {
    message: string;
    acknowledged: boolean;
    acknowledge: (acknowledged: boolean) => void;
  } | null;
  // Resolves to why the save didn't go through, or null once every staged
  // edit saved; `with` saves alongside them, in the same request.
  saveAll: (with_?: ExperimentChangesBody) => Promise<SaveRefusal | null>;
  // Staged fields join this form through their `form` attribute, so a value
  // their own constraints refuse stops the save.
  formId: string;
  discardAll: () => void;
  staged: { id: string; label: string }[];
  // Staged edits whose fields someone else saved since they were made.
  conflicts: string[];
  markDrifted: (id: string, drifted: boolean) => void;
  // Status-bound edits made before the experiment's status changed, with the
  // status each was made under.
  incompatible: IncompatibleEdit[];
  markIncompatible: (id: string, stagedIn: string | null) => void;
  // Saves this edit over the other change next time.
  keepMine: (id: string) => void;
  discard: (id: string) => void;
  review: (id: string) => StagedReview | null;
  register: (id: string, edit: PendingEdit | null) => void;
  checkChanges: CheckChanges;
  checkAll: () => Promise<void>;
  allowUnload: () => void;
  // A dialog that stages is open: clean edits keep what it opened against.
  holdingBases: boolean;
  holdBases: () => () => void;
}

// Runs the save's checks with `part` standing in for edit `id`'s share,
// writing nothing; rejects with the reason the save would be refused.
type CheckChanges = (id: string, part: ExperimentChangesBody) => Promise<void>;

const ExperimentEditsContext = createContext<ExperimentEditsValue | null>(null);

// `onPage` when it's resolved on the page, by its fields or the save bar.
export type SaveRefusal = { message: string; onPage: boolean };

export function incompatibleNote(incompatible: IncompatibleEdit[]): string {
  const one = incompatible.length === 1;
  const why = incompatible.every((e) => e.stagedIn === "draft")
    ? "This experiment is no longer a draft"
    : `This experiment's status changed since ${one ? "it was" : "they were"} made`;
  return `${why}, so ${
    one ? "1 change" : `${incompatible.length} changes`
  } can't be saved. Discard ${one ? "it" : "them"} to save the rest.`;
}

const INVALID_FIELDS = "Fill in the highlighted fields to save.";
const CONFLICTED = "Someone else saved changes to what you edited.";

type ChangesConflict = ApiErrorDetails<"changes_conflict">;

// The save stopped on a conflict, which the bar and the conflicting rows show.
class ConflictFlagged extends Error {}

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
  { fields, featureIds, urlRedirectIds, visualChangesetIds }: ChangesConflict,
): boolean {
  return (
    Object.keys(share?.experiment?.changes ?? {}).some((key) =>
      fields.includes(key),
    ) ||
    !!share?.flagValues?.some((f) => featureIds.includes(f.featureId)) ||
    !!share?.editUrlRedirects?.some((r) => urlRedirectIds.includes(r.id)) ||
    !!share?.editVisualChangesets?.some((c) =>
      visualChangesetIds.includes(c.id),
    )
  );
}

/**
 * Carries each field's value in `base` (see useEditBase), so a save over
 * someone else's change fails instead of overwriting it.
 */
export function experimentFieldChanges(
  base: ExperimentInterfaceStringDates,
  changes: ExperimentChangesFields,
): ExperimentChangesBody {
  const loaded: Record<string, unknown> = {};
  for (const key of Object.keys(changes)) {
    loaded[key] = experimentFieldValue(base, key);
  }
  return { experiment: { changes, base: loaded } };
}

const STAGED_EDITS_PREFIX = "gb-experiment-edits";

// Per experiment, whatever its status: edits a status change leaves behind
// stay to be saved or discarded (see `statusBound`).
export function stagedEditsScope(
  experiment: Pick<ExperimentInterfaceStringDates, "id">,
): string {
  return experiment.id;
}

// Nothing staged: the slot reads as its caller's `initial`, so it follows what
// is stored until someone changes it.
const UNSET: unique symbol = Symbol("unset");
type Stored<T> = T | typeof UNSET;

// One value per key, shared by every component staging it and kept in
// sessionStorage, so a reload or a second view of the same slot agrees.
const stagedValues = new Map<string, unknown>();
const stagedListeners = new Map<string, Set<() => void>>();

function readStaged(key: string): unknown {
  if (!stagedValues.has(key)) {
    let value: unknown = UNSET;
    try {
      const stored = sessionStorage.getItem(key);
      if (stored !== null) value = JSON.parse(stored);
    } catch {
      // Unavailable storage leaves it unstaged.
    }
    stagedValues.set(key, value);
  }
  return stagedValues.get(key);
}

function writeStaged(key: string, value: unknown) {
  stagedValues.set(key, value);
  try {
    if (value === UNSET) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Kept in memory for this page view.
  }
  stagedListeners.get(key)?.forEach((listener) => listener());
}

function subscribeStaged(key: string, listener: () => void) {
  const listeners = stagedListeners.get(key) ?? new Set<() => void>();
  listeners.add(listener);
  stagedListeners.set(key, listeners);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) stagedListeners.delete(key);
  };
}

/**
 * State that waits for the page's Save, shared by every component staging the
 * slot. Set back to `initial`, it's unstaged and follows `initial` again.
 */
export function useStagedState<T>(
  slot: string,
  initial: T,
  scope?: string | null,
): [T, Dispatch<SetStateAction<T>>, () => void] {
  const providerScope = useContext(ExperimentEditsContext)?.scope ?? null;
  const resolvedScope = scope === undefined ? providerScope : scope;
  const key = resolvedScope
    ? `${STAGED_EDITS_PREFIX}:${resolvedScope}:${slot}`
    : null;
  // With no scope there's nowhere to share it, so it's this component's alone.
  const [local, setLocal] = useState<Stored<T>>(UNSET);
  const subscribe = useCallback(
    (listener: () => void) =>
      key ? subscribeStaged(key, listener) : () => undefined,
    [key],
  );
  const shared = useSyncExternalStore(
    subscribe,
    () => (key ? readStaged(key) : UNSET),
    () => UNSET,
  );
  const stored = (key ? shared : local) as Stored<T>;
  const value = stored === UNSET ? initial : stored;

  const latest = useRef({ key, initial });
  latest.current = { key, initial };
  const set: Dispatch<SetStateAction<T>> = useCallback((next) => {
    const { key, initial } = latest.current;
    const resolve = (prev: Stored<T>): Stored<T> => {
      const from = prev === UNSET ? initial : prev;
      const to =
        typeof next === "function" ? (next as (prev: T) => T)(from) : next;
      return JSON.stringify(to) === JSON.stringify(initial) ? UNSET : to;
    };
    if (key) writeStaged(key, resolve(readStaged(key) as Stored<T>));
    else setLocal(resolve);
  }, []);
  // Back to following `initial`, whatever it is by then.
  const clear = useCallback(() => {
    const { key } = latest.current;
    if (key) writeStaged(key, UNSET);
    else setLocal(UNSET);
  }, []);
  return [value, set, clear];
}

function withId(ids: string[], id: string, on: boolean): string[] {
  if (on === ids.includes(id)) return ids;
  return on ? [...ids, id] : ids.filter((d) => d !== id);
}

// Collects the page's in-place edits so one Save writes them together.
export function ExperimentEditsProvider({
  experiment,
  mutate,
  children,
}: {
  experiment: ExperimentInterfaceStringDates;
  mutate: () => unknown;
  children: ReactNode;
}) {
  const { apiCall } = useAuth();
  const experimentId = experiment.id;
  const scope = stagedEditsScope(experiment);
  const edits = useRef(new Map<string, PendingEdit>());

  const [staged, setStaged] = useState<{ id: string; label: string }[]>([]);
  const [saving, setSaving] = useState(false);
  // Read by discards, which mid-save would drop a value the save still writes.
  const savingNow = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshFailed, setRefreshFailed] = useState(false);
  // Any refetch that lands shows what saved.
  useEffect(() => setRefreshFailed(false), [experiment]);
  const [unscopedRefusal, setUnscopedRefusal] = useState<string | null>(null);
  const [allowUnscopedRules, setAllowUnscopedRules] = useState(false);
  const [conflicts, setConflicts] = useState<string[]>([]);
  const [holds, setHolds] = useState(0);
  const holdBases = useCallback(() => {
    setHolds((n) => n + 1);
    return () => setHolds((n) => n - 1);
  }, []);
  const [drifted, setDrifted] = useState<string[]>([]);
  const formId = useId();
  const form = useRef<HTMLFormElement>(null);
  // A rebase reads the page as rendered, so it waits for the refetch to render.
  const rebaseOnRender = useRef<PendingEdit[]>([]);
  const [refetched, setRefetched] = useState(0);
  useEffect(() => {
    rebaseOnRender.current.forEach((edit) => edit.rebase?.());
    rebaseOnRender.current = [];
  }, [refetched]);

  const markDrifted = useCallback(
    (id: string, isDrifted: boolean) =>
      setDrifted((prev) => withId(prev, id, isDrifted)),
    [],
  );
  const [incompatible, setIncompatible] = useState<IncompatibleEdit[]>([]);
  const markIncompatible = useCallback(
    (id: string, stagedIn: string | null) =>
      setIncompatible((prev) => {
        const entry = prev.find((e) => e.id === id);
        if ((entry?.stagedIn ?? null) === stagedIn) return prev;
        const rest = prev.filter((e) => e.id !== id);
        return stagedIn ? [...rest, { id, stagedIn }] : rest;
      }),
    [],
  );
  // Refused by a save, or already shown by a refetch: either way, resolved the
  // same way.
  const shownConflicts = useMemo(
    () => [...new Set([...conflicts, ...drifted])],
    [conflicts, drifted],
  );

  const register = useCallback(
    (id: string, edit: PendingEdit | null) => {
      if (edit) {
        edits.current.set(id, edit);
      } else {
        edits.current.delete(id);
        setDrifted((prev) => withId(prev, id, false));
        markIncompatible(id, null);
      }
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
    },
    [markIncompatible],
  );

  const postChanges = useCallback(
    (parts: ExperimentChangesBody[], dryRun: boolean) =>
      apiCall(`/experiment/${experimentId}/changes`, {
        method: "POST",
        body: JSON.stringify({
          ...mergeChanges(parts),
          ...(allowUnscopedRules && { allowUnscopedRules: true }),
          ...(dryRun && { dryRun: true }),
        }),
      }),
    [apiCall, experimentId, allowUnscopedRules],
  );

  const saveAll = useCallback(
    async (with_?: ExperimentChangesBody) => {
      // The browser says which field and why, and takes the writer there.
      if (form.current && !form.current.reportValidity()) {
        setError(INVALID_FIELDS);
        return { message: INVALID_FIELDS, onPage: true };
      }
      // Whatever asks for the save, not only the bar's disabled button.
      if (incompatible.length) {
        return { message: incompatibleNote(incompatible), onPage: true };
      }
      let refusal: SaveRefusal | null = null;
      setSaving(true);
      savingNow.current = true;
      setError(null);
      setConflicts([]);
      const pending = [...edits.current.entries()];
      // A refused save keeps each edit's base, so a retry can't quietly
      // overwrite the change that refused it.
      const saved: { edit: PendingEdit; sent: ExperimentChangesBody }[] = [];
      // Even when refused: some refusals come after part of the save landed.
      let posted = false;
      try {
        if (pending.length || with_) {
          const sent = pending.map(([, edit]) =>
            edit.changes({ dryRun: false }),
          );
          posted = true;
          try {
            await postChanges(with_ ? [...sent, with_] : sent, false);
          } catch (e) {
            const conflict = changesConflict(e);
            if (!conflict) throw e;
            // Refetched, so keeping an edit takes what was saved as its base.
            setConflicts(
              pending
                .filter(([, edit]) => touches(dryRunShare(edit), conflict))
                .map(([id]) => id),
            );
            throw new ConflictFlagged();
          }
          saved.push(
            ...pending.map(([, edit], i) => ({ edit, sent: sent[i] })),
          );
        }
        setUnscopedRefusal(null);
        setAllowUnscopedRules(false);
      } catch (e) {
        // A conflict shows on the bar and its rows, not as an error.
        if (e instanceof ConflictFlagged) {
          refusal = { message: CONFLICTED, onPage: true };
        } else {
          const message = e.message || "Could not save your changes";
          const unscoped =
            e instanceof ApiCallError && e.code === "unscoped_rule";
          if (unscoped) setUnscopedRefusal(message);
          else setError(message);
          refusal = { message, onPage: unscoped };
        }
      } finally {
        // One changed while it saved stays staged, over what it saved. Judged
        // before the refetch, which moves a saved edit's share by itself.
        const settled = saved.map(({ edit, sent }) => ({
          edit,
          unchanged: isEqual(dryRunShare(edit), sent),
        }));
        // Cleared once the refetch lands, so the page never shows the old values.
        // A failed refetch still ends the save; what saved shows on reload.
        if (posted) {
          try {
            await mutate();
          } catch {
            setRefreshFailed(true);
          }
        }
        settled.forEach(({ edit, unchanged }) => {
          if (unchanged) edit.onSaved?.();
          else rebaseOnRender.current.push(edit);
        });
        if (rebaseOnRender.current.length) setRefetched((n) => n + 1);
        savingNow.current = false;
        setSaving(false);
      }
      return refusal;
    },
    [postChanges, mutate, incompatible],
  );

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
    if (savingNow.current) return;
    [...edits.current.values()].forEach((edit) => edit.discard());
    setError(null);
    setConflicts([]);
    setUnscopedRefusal(null);
    setAllowUnscopedRules(false);
  }, []);

  const resolve = useCallback((id: string) => {
    setConflicts((prev) => prev.filter((c) => c !== id));
  }, []);
  const discard = useCallback(
    (id: string) => {
      if (savingNow.current) return;
      edits.current.get(id)?.discard();
      resolve(id);
    },
    [resolve],
  );
  const keepMine = useCallback(
    (id: string) => {
      if (savingNow.current) return;
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
      await postChanges([...parts, ...extra], true);
    },
    [postChanges],
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
  // Why the last save didn't go through, if it didn't.
  const refusal =
    error ?? unscopedRefusal ?? (shownConflicts.length ? CONFLICTED : null);
  // Leaving mid-save waits for it: saved through, it goes; left with
  // something unsaved, it asks as usual.
  const leaveAfterSave =
    !!navigationGuard.pendingHref && !saving && !staged.length;
  const { confirmNavigation } = navigationGuard;
  useEffect(() => {
    if (leaveAfterSave) confirmNavigation();
  }, [leaveAfterSave, confirmNavigation]);
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
      experiment,
      dirty: staged.length > 0,
      saving,
      error,
      refreshFailed,
      unscopedRule,
      saveAll,
      formId,
      discardAll,
      staged,
      conflicts: shownConflicts,
      markDrifted,
      incompatible,
      markIncompatible,
      keepMine,
      discard,
      review,
      register,
      checkChanges,
      checkAll,
      allowUnload,
      holdingBases: holds > 0,
      holdBases,
    }),
    [
      holds,
      holdBases,
      scope,
      experiment,
      staged,
      shownConflicts,
      markDrifted,
      incompatible,
      markIncompatible,
      keepMine,
      saving,
      error,
      refreshFailed,
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
      {navigationGuard.pendingHref && !saving ? (
        // Refused on the way out, it says why rather than calling them unsaved.
        <ConfirmDialog
          title={
            refusal ? "Your changes weren't saved" : "Leave without saving?"
          }
          content={
            refusal ? (
              <Flex direction="column" gap="2">
                <Text>{refusal}</Text>
                <Text>Leaving this page discards your changes.</Text>
              </Flex>
            ) : (
              "You have unsaved changes to this experiment. Leaving this page discards them."
            )
          }
          // Staying is the primary action; leaving is the secondary one.
          yesText={refusal ? "Stay and fix" : "Keep editing"}
          noText="Leave page"
          onConfirm={navigationGuard.cancelNavigation}
          onCancel={navigationGuard.confirmNavigation}
          onDismiss={navigationGuard.cancelNavigation}
        />
      ) : null}
    </ExperimentEditsContext.Provider>
  );
}

export function useExperimentEdits() {
  return useContext(ExperimentEditsContext);
}

// A field's pending change; `dirty` false drops it from the pending set.
export function useRegisterExperimentEdit(
  id: string,
  dirty: boolean,
  edit: PendingEdit,
) {
  const ctx = useContext(ExperimentEditsContext);
  // Stable, unlike the context around it, which changes with every staged
  // edit: keyed on that, each change would unregister and re-register them all.
  const register = ctx?.register;
  const markDrifted = ctx?.markDrifted;
  const markIncompatible = ctx?.markIncompatible;
  const latest = useRef(edit);
  latest.current = edit;

  // The status it was staged under, kept across reloads like the edit.
  const status = ctx?.experiment.status ?? null;
  const statusBound = !!edit.statusBound;
  const [stagedIn] = useEditBase(
    `status:${id}`,
    statusBound && dirty,
    () => status,
  );
  const incompatible =
    statusBound && dirty && stagedIn !== null && stagedIn !== status;
  useEffect(() => {
    markIncompatible?.(id, incompatible ? stagedIn : null);
  }, [markIncompatible, id, incompatible, stagedIn]);

  // A refetched save by someone else over this edit's fields is flagged now,
  // not when Save is refused.
  const share = ctx && dirty ? dryRunShare(edit) : null;
  const drifted =
    !!ctx &&
    !!share &&
    conflictingFields(ctx.experiment, share.experiment).length > 0;
  useEffect(() => {
    markDrifted?.(id, drifted);
  }, [markDrifted, id, drifted]);

  const label = edit.label;
  useEffect(() => {
    if (!register) return;
    const discard = () => latest.current.discard();
    const onSaved = () => (latest.current.onSaved ?? latest.current.discard)();
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
            changes: (options: { dryRun: boolean }) =>
              latest.current.changes(options),
          }
        : null,
    );
  }, [register, id, dirty, label]);

  useEffect(() => {
    return () => register?.(id, null);
  }, [register, id]);
}

const editBaseSlot = (slot: string) => `base:${slot}`;

export type TargetingBase = {
  experiment: ExperimentInterfaceStringDates;
  targeting: ExperimentTargetingData;
};

export type StageTargeting = (
  value: ExperimentTargetingData,
  opened: TargetingBase,
) => void;

/**
 * The page's staged targeting. A modal stages it with what it opened against
 * as the edit's base, unless an earlier base is staged, so a save made while
 * it was open conflicts instead of being overwritten.
 */
export function useStagedTargeting(
  experiment: Pick<ExperimentInterfaceStringDates, "id"> | undefined,
) {
  const scope = experiment ? stagedEditsScope(experiment) : null;
  const [draft, setDraft] = useStagedState<ExperimentTargetingData | null>(
    "targeting",
    null,
    scope,
  );
  const [base, setBase] = useStagedState<TargetingBase | null>(
    editBaseSlot("targeting"),
    null,
    scope,
  );
  const stage = useCallback<StageTargeting>(
    (value, opened) => {
      // The draft first: a base staged alone reads as nothing staged, and
      // the edit drops it.
      setDraft(value);
      if (!base) setBase(opened);
    },
    [base, setBase, setDraft],
  );
  return { value: draft, set: setDraft, stage };
}

/**
 * What an edit was made against: taken when it's first staged and kept,
 * reloads included, so a save compares against it rather than a later refetch.
 */
export function useEditBase<B>(
  slot: string,
  dirty: boolean,
  snapshot: () => B,
): [B | null, () => void] {
  const [base, setBase] = useStagedState<B | null>(editBaseSlot(slot), null);
  const latest = useRef(snapshot);
  latest.current = snapshot;
  // Taken when a dialog opens over a clean edit, so what the dialog stages is
  // judged against what it showed, not a refresh while it was open.
  const held = useRef<{ base: B } | null>(null);
  const holding = useContext(ExperimentEditsContext)?.holdingBases ?? false;
  useEffect(() => {
    if (dirty) {
      if (base === null) setBase(held.current?.base ?? latest.current());
      held.current = null;
      return;
    }
    if (base !== null) setBase(null);
    if (!holding) held.current = null;
    else if (!held.current) held.current = { base: latest.current() };
  }, [dirty, base, setBase, holding]);
  const rebase = useCallback(() => setBase(latest.current()), [setBase]);
  return [base, rebase];
}

/** While a dialog that stages is open, clean edits keep what it opened against. */
export function useHoldEditBases(open: boolean) {
  const hold = useContext(ExperimentEditsContext)?.holdBases;
  useEffect(() => (open ? hold?.() : undefined), [hold, open]);
}

/** What saving these fields would change against the experiment as it is now. */
export function reviewAgainstCurrent(
  experiment: ExperimentInterfaceStringDates,
  fields: ExperimentChangesFields,
): StagedReview {
  return reviewFromChanges(experimentFieldChanges(experiment, fields));
}

/** An edit to experiment fields, saved against the experiment as it began. */
export function useExperimentFieldEdit(
  id: string,
  dirty: boolean,
  experiment: ExperimentInterfaceStringDates,
  {
    fields,
    ...edit
  }: Pick<
    PendingEdit,
    "label" | "review" | "discard" | "onSaved" | "statusBound"
  > & {
    fields: () => ExperimentChangesFields;
  },
) {
  const [base, rebase] = useEditBase(id, dirty, () => experiment);
  useRegisterExperimentEdit(id, dirty, {
    review: () => reviewAgainstCurrent(experiment, fields()),
    ...edit,
    rebase,
    changes: () => experimentFieldChanges(base ?? experiment, fields()),
  });
}

export function useEditsBlockedReason(): string | null {
  const ctx = useContext(ExperimentEditsContext);
  return ctx?.dirty ? "Save or discard your changes first." : null;
}

// An upload writes to the stored variation at an index staged variation edits
// may have moved, and saving them would drop it.
/** An id to join, "" to leave, or null for none staged. */
export interface HoldoutDraft {
  value: string | null;
  set: (value: string | null) => void;
}

// Environment scopes staged per Feature Flag, saved with that flag's values.
export interface FlagEnvironmentsDraft {
  value: Record<string, ExperimentRuleEnvironments>;
  set: (featureId: string, scope: ExperimentRuleEnvironments | null) => void;
}

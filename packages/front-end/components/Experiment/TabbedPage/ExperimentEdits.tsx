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
  ImplementationType,
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
  /** Anything on the page edited but not yet written. */
  dirty: boolean;
  saving: boolean;
  error: string | null;
  saveAll: () => Promise<void>;
  discardAll: () => void;
  register: (id: string, edit: PendingEdit | null) => void;
  checkChanges: CheckChanges;
}

/**
 * Runs the save's checks, writing nothing, with `part` standing in for edit
 * `id`'s share. Rejects with the reason the save would be refused.
 */
type CheckChanges = (id: string, part: ExperimentChangesBody) => Promise<void>;

const ExperimentEditsContext = createContext<ExperimentEditsValue | null>(null);

interface LiveViewValue {
  /** The page shows live values in place of unpublished ones; nothing edits. */
  live: boolean;
  setLive: (live: boolean) => void;
}

const LiveViewContext = createContext<LiveViewValue | null>(null);

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
  // Held against the experiment it was picked on, so it doesn't follow the
  // page to another one.
  const [liveFor, setLiveFor] = useState<string | null>(null);
  const liveView = useMemo(
    () => ({
      live: liveFor === experimentId,
      setLive: (live: boolean) => setLiveFor(live ? experimentId : null),
    }),
    [liveFor, experimentId],
  );

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

  const value = useMemo(
    () => ({
      dirty: dirtyIds.length > 0,
      saving,
      error,
      saveAll,
      discardAll,
      register,
      checkChanges,
    }),
    [dirtyIds, saving, error, saveAll, discardAll, register, checkChanges],
  );

  return (
    <ExperimentEditsContext.Provider value={value}>
      <LiveViewContext.Provider value={liveView}>
        {children}
      </LiveViewContext.Provider>
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

/** Whether the page is showing live values, read-only, rather than unpublished ones. */
export function useLiveView(): LiveViewValue {
  return useContext(LiveViewContext) ?? { live: false, setLive: () => {} };
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

/**
 * An implementation type staged for the page's Save. Leaving Values deletes the
 * managed flag, which the save has to acknowledge.
 */
export interface ImplementationTypeDraft {
  value: { type: ImplementationType; deletesManagedFlag: boolean } | null;
  set: (value: ImplementationTypeDraft["value"]) => void;
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

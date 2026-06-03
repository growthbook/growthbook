import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { ApiContextualBanditInterface } from "shared/validators";
import { useMemo } from "react";
import useApi from "./useApi";

/**
 * Fetches CB docs from the new REST API (`/api/v1/contextual-bandits`).
 *
 * Returns the raw API shape (`ApiContextualBanditInterface`) AND an
 * experiment-shaped projection (`experiments`) that the existing CB list
 * page can consume without changes to its rendering, sort/filter, and
 * `useExperimentSearch` plumbing.
 *
 * The experiment-shaped projection is intentionally transitional — once
 * the list page (PR-6 follow-up) and `useExperimentSearch` (PR-6 also)
 * are forked to CB-native types, callers will switch to
 * `contextualBandits` directly and the projection can be deleted.
 */
export function useContextualBandits(
  project?: string,
  includeArchived: boolean = false,
) {
  // The REST list endpoint supports projectId filtering server-side; the
  // archived flag is applied client-side because the BaseModel CRUD list
  // doesn't expose an `archived` filter yet.
  const path = `/contextual-bandits${project ? `?projectId=${encodeURIComponent(project)}` : ""}`;
  const { data, error, mutate } = useApi<{
    contextualBandits: ApiContextualBanditInterface[];
  }>(path);

  const allContextualBandits = useMemo(
    () => data?.contextualBandits ?? [],
    [data],
  );

  const contextualBandits = useMemo(
    () =>
      includeArchived
        ? allContextualBandits
        : allContextualBandits.filter((cb) => !cb.archived),
    [allContextualBandits, includeArchived],
  );

  // Experiment-shaped projection — the list page's sort/filter (via
  // `useExperimentSearch`) reads ExperimentInterfaceStringDates fields.
  // We supply CB-native data, with empty/default values for fields that
  // don't apply to CBs (`hasVisualChangesets`, `hasURLRedirects`,
  // `results`, etc.). The cast preserves type-safety at the boundary —
  // downstream consumers see the experiment shape they expect.
  const experiments = useMemo<ExperimentInterfaceStringDates[]>(
    () =>
      contextualBandits.map(
        (cb) =>
          ({
            id: cb.id,
            dateCreated: cb.dateCreated,
            dateUpdated: cb.dateUpdated,
            organization: "",
            name: cb.name,
            description: cb.description,
            hypothesis: cb.hypothesis,
            project: cb.project,
            owner: cb.owner,
            tags: cb.tags,
            archived: cb.archived,
            customFields: cb.customFields,
            status: cb.status,
            trackingKey: cb.trackingKey,
            hashAttribute: cb.hashAttribute,
            fallbackAttribute: cb.fallbackAttribute,
            hashVersion: cb.hashVersion,
            disableStickyBucketing: cb.disableStickyBucketing,
            variations: cb.variations,
            phases: cb.phases.map((p) => ({
              dateStarted: p.dateStarted,
              dateEnded: p.dateEnded ?? undefined,
              name: "Main",
              reason: "",
              coverage: p.coverage ?? 1,
              condition: p.condition ?? "",
              variationWeights:
                p.variationWeights ?? cb.variations.map(() => 1),
              variations: cb.variations.map((v) => ({ id: v.id })),
              seed: p.seed,
            })),
            datasource: cb.datasource,
            exposureQueryId: cb.exposureQueryId,
            segment: cb.segment,
            queryFilter: cb.queryFilter,
            goalMetrics: cb.goalMetrics,
            secondaryMetrics: cb.secondaryMetrics,
            guardrailMetrics: cb.guardrailMetrics,
            activationMetric: cb.activationMetric,
            attributionModel: cb.attributionModel,
            skipPartialData: cb.skipPartialData,
            regressionAdjustmentEnabled: cb.regressionAdjustmentEnabled,
            type: "contextual-bandit",
            implementation: "code",
            autoAssign: false,
            previewURL: "",
            targetURLRegex: "",
            releasedVariationId: "",
            autoSnapshots: false,
            // CB-specific fields the list page reads conditionally
            // (visual / URL-redirect badges, linked-feature flag, etc.)
            hasVisualChangesets: false,
            hasURLRedirects: false,
            linkedFeatures: [],
          }) as unknown as ExperimentInterfaceStringDates,
      ),
    [contextualBandits],
  );

  return {
    loading: !error && !data,
    contextualBandits,
    experiments,
    error,
    mutate,
    hasArchived: allContextualBandits.some((cb) => cb.archived),
  };
}

/**
 * Single-CB fetch via `GET /api/v1/contextual-bandits/:id` (the standard
 * CRUD endpoint added in PR-4). Returns the API-shape directly — no
 * experiment-shape projection because callers of this hook are
 * specifically opting into the CB-native surface.
 *
 * Building block for the PR-6 detail-page fork: once the detail page
 * stops fetching `/experiment/${cbid}` and reads CB-native fields off
 * this hook, the parent-experiment indirection (and its dependent
 * components like SnapshotProvider, TabbedPage) can be refactored to
 * accept a CB doc directly.
 */
export function useContextualBandit(cbId: string | undefined) {
  const { data, error, mutate } = useApi<{
    contextualBandit: ApiContextualBanditInterface;
  }>(cbId ? `/contextual-bandits/${cbId}` : "/contextual-bandits/__missing__", {
    shouldRun: () => !!cbId,
  });

  return {
    loading: !!cbId && !error && !data,
    contextualBandit: data?.contextualBandit,
    error,
    mutate,
  };
}

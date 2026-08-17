import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Flex } from "@radix-ui/themes";
import { PiPlus } from "react-icons/pi";
import { ExplorationConfig, FunnelDataset } from "shared/validators";
import { isFactFunnelMetric } from "shared/experiments";
import {
  deriveFunnelUnit,
  funnelSettingsToFunnelDataset,
  MAX_FUNNEL_STEPS,
} from "shared/funnels";
import { isProjectListValidForProject } from "shared/util";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import SelectField from "@/components/Forms/SelectField";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import {
  createEmptyFunnelStep,
  getFunnelUnitOptions,
  getInitialInlineFilters,
} from "@/enterprise/components/ProductAnalytics/util";
import FunnelStepCard from "./FunnelStepCard";

/** Per-step UI state owned by this parent (not the card) so we can
 *  auto-collapse non-user-expanded steps when a new step is added.
 *  `userExpanded` is set when the user explicitly opens a step — those
 *  are "locked open" and skipped by the auto-collapse logic. */
type StepUiState = { collapsed: boolean; userExpanded: boolean };

export default function FunnelTabContent() {
  const {
    draftExploreState,
    setDraftExploreState,
    registerFunnelAnalyzeCollapseHandler,
    linkedFunnelMetricId,
    setLinkedFunnelMetricId,
    funnelLinkIsDirty,
    clearAllDatasets,
  } = useExplorerContext();
  const {
    getFactTableById,
    factTables,
    factMetrics,
    getFactMetricById,
    project,
    ready,
  } = useDefinitions();

  const isFunnel = draftExploreState.dataset?.type === "funnel";
  const stepsLength = isFunnel
    ? (draftExploreState.dataset as FunnelDataset).steps.length
    : 0;

  const [instantCollapseTransition, setInstantCollapseTransition] =
    useState(false);

  const [uiState, setUiState] = useState<StepUiState[]>(() => {
    // When the page initializes from a URL/saved config, steps already
    // have fact tables and filters — show them collapsed so the user
    // sees the funnel shape, not a wall of expanded editors. The "fresh"
    // case (single step with no fact table) starts expanded so there's
    // a ready-to-edit form.
    const initialSteps = isFunnel
      ? (draftExploreState.dataset as FunnelDataset).steps
      : [];
    const hasConfiguredStep = initialSteps.some((s) => !!s.factTableId);
    return initialSteps.map(() => ({
      collapsed: hasConfiguredStep,
      userExpanded: false,
    }));
    // Intentionally only run on mount — auto-collapse on URL/saved
    // re-initialization should not re-trigger as the user edits.
  });

  // Keep the UI-state array in lockstep with the steps array length. The
  // draft can change from outside this component (URL state, AI agent,
  // clearAllDatasets), so we resize defensively. The mapping is positional
  // — for the move/delete/add handlers below we re-sync explicitly so the
  // per-step flags follow the step.
  useEffect(() => {
    setUiState((prev) => {
      if (prev.length === stepsLength) return prev;
      const next = prev.slice(0, stepsLength);
      while (next.length < stepsLength) {
        next.push({ collapsed: false, userExpanded: false });
      }
      return next;
    });
  }, [stepsLength]);

  useEffect(() => {
    if (!instantCollapseTransition) return;
    setInstantCollapseTransition(false);
  }, [instantCollapseTransition]);

  const funnelDataset =
    draftExploreState.dataset?.type === "funnel"
      ? draftExploreState.dataset
      : null;

  const funnelUnitOptions = useMemo(
    () =>
      funnelDataset ? getFunnelUnitOptions(funnelDataset, factTables) : [],
    [funnelDataset, factTables],
  );

  const funnelStepFactTablesKey = useMemo(
    () => funnelDataset?.steps.map((s) => s.factTableId ?? "").join("|") ?? "",
    [funnelDataset],
  );

  useEffect(() => {
    setDraftExploreState((prev) => {
      if (prev.dataset.type !== "funnel") return prev;
      const opts = getFunnelUnitOptions(prev.dataset, factTables);
      const current = prev.dataset.unit;
      if (opts.length === 0) {
        if (current == null) return prev;
        return {
          ...prev,
          dataset: { ...prev.dataset, unit: null },
        } as ExplorationConfig;
      }
      if (!current || !opts.includes(current)) {
        return {
          ...prev,
          dataset: { ...prev.dataset, unit: opts[0] },
        } as ExplorationConfig;
      }
      return prev;
    });
  }, [factTables, funnelStepFactTablesKey, setDraftExploreState]);

  // Funnel fact metrics that can be loaded into this builder. Scoped to the
  // exploration's datasource (steps can only reference its fact tables) and
  // the active project, matching every other metric picker.
  const funnelMetricOptions = useMemo(
    () =>
      factMetrics
        .filter(isFactFunnelMetric)
        .filter((m) => m.datasource === draftExploreState.datasource)
        .filter((m) => isProjectListValidForProject(m.projects, project))
        .map((m) => ({ label: m.name, value: m.id })),
    [factMetrics, draftExploreState.datasource, project],
  );

  /**
   * Start over on a blank funnel, keeping the current data source.
   */
  const resetToNewFunnel = useCallback(() => {
    clearAllDatasets(draftExploreState.datasource);
    // One empty step, expanded and ready to edit — matching a fresh page.
    setInstantCollapseTransition(true);
    setUiState([{ collapsed: false, userExpanded: false }]);
  }, [clearAllDatasets, draftExploreState.datasource]);

  // Switching project clears the funnel outright — steps included, linked or
  // not. A funnel is defined by fact tables and metrics that are themselves
  // project-scoped, so carrying one across a project switch means showing (and
  // being able to Analyze) another project's data under the new project's
  // heading. Clearing the link alone isn't enough: the steps are the funnel.
  //
  // Deliberately unconditional. A hand-built funnel on an All-Projects fact
  // table would technically still be valid, but "sometimes it survives" is a
  // worse rule to hold than "changing project starts fresh", and exploration
  // is cheap to redo by design (§7 decision 7).
  const previousProjectRef = useRef(project);
  useEffect(() => {
    if (previousProjectRef.current === project) return;
    previousProjectRef.current = project;
    resetToNewFunnel();
  }, [project, resetToNewFunnel]);

  // The funnel outlives its own definitions in more ways than a project
  // switch. Switching *organization* is the sharpest: the config survives in
  // `?config=` while every fact table it names belongs to the org you left, so
  // the steps render raw ids like `ftb_19wub…` and nothing can resolve. The
  // same happens if a fact table is deleted underneath you.
  //
  // So rather than watching identity (project, org), watch the thing that
  // actually matters: can every step still resolve its fact table? That covers
  // org switches, deleted fact tables, and any future scope change, without
  // needing to know which one happened.
  const hasUnresolvableStep = useMemo(() => {
    if (!ready || draftExploreState.dataset?.type !== "funnel") return false;
    return draftExploreState.dataset.steps.some(
      (step) => step.factTableId && !getFactTableById(step.factTableId),
    );
  }, [ready, draftExploreState.dataset, getFactTableById]);

  useEffect(() => {
    if (hasUnresolvableStep) resetToNewFunnel();
  }, [hasUnresolvableStep, resetToNewFunnel]);

  // A linked metric can also vanish on its own — archived or deleted by
  // someone else, or no longer in the active project. Waits for `ready` so the
  // initial definitions load isn't mistaken for the metric disappearing.
  useEffect(() => {
    if (!ready || !linkedFunnelMetricId) return;
    if (funnelMetricOptions.some((o) => o.value === linkedFunnelMetricId)) {
      return;
    }
    // The metric link is optional metadata. A stale link must not discard a
    // valid funnel restored from `?config=`.
    setLinkedFunnelMetricId(null);
  }, [
    ready,
    linkedFunnelMetricId,
    funnelMetricOptions,
    setLinkedFunnelMetricId,
  ]);

  /** Replace the funnel with a saved metric's steps and link it. */
  const handleLoadFunnelMetric = (metricId: string) => {
    if (!metricId) {
      resetToNewFunnel();
      return;
    }
    const metric = getFactMetricById(metricId);
    if (!metric || !isFactFunnelMetric(metric)) return;

    setDraftExploreState((prev) => {
      if (prev.dataset.type !== "funnel") return prev;
      // A funnel metric carries no counting unit, so derive one that exists on
      // every step's fact table. Keep the unit already in use when it still
      // qualifies, so switching metrics doesn't silently recount.
      const unit = deriveFunnelUnit({
        steps: metric.funnelSettings.steps,
        getFactTable: (id) => getFactTableById(id) ?? undefined,
        preferredUnit: prev.dataset.unit,
      });
      return {
        ...prev,
        dataset: {
          ...funnelSettingsToFunnelDataset(metric.funnelSettings, unit),
          // Display-only, belongs to the exploration rather than the metric.
          yAxisScale: prev.dataset.yAxisScale,
        },
      } as ExplorationConfig;
    });
    setLinkedFunnelMetricId(metricId);
    // Loaded steps are already configured, so show the funnel's shape rather
    // than a stack of open editors (same rationale as initializing from a URL).
    setInstantCollapseTransition(true);
    setUiState(
      metric.funnelSettings.steps.map(() => ({
        collapsed: true,
        userExpanded: false,
      })),
    );
  };

  useEffect(() => {
    registerFunnelAnalyzeCollapseHandler(() => {
      setInstantCollapseTransition(true);
      setUiState((prev) =>
        prev.map((s) => (s.userExpanded ? s : { ...s, collapsed: true })),
      );
    });
    return () => registerFunnelAnalyzeCollapseHandler(null);
  }, [registerFunnelAnalyzeCollapseHandler]);

  if (!isFunnel) return null;
  const dataset = draftExploreState.dataset as FunnelDataset;
  const steps = dataset.steps;

  const allStepsHaveFactTable = steps.every((s) => !!s.factTableId);

  const handleToggleCollapsed = (index: number) => {
    setUiState((prev) =>
      prev.map((s, i) => {
        if (i !== index) return s;
        const nextCollapsed = !s.collapsed;
        // Expanding via the chevron locks the step open; collapsing resets
        // the lock so a future "add step" can collapse it again.
        return { collapsed: nextCollapsed, userExpanded: !nextCollapsed };
      }),
    );
  };

  const handleDelete = (index: number) => {
    setDraftExploreState((prev) => {
      if (prev.dataset.type !== "funnel") return prev;
      return {
        ...prev,
        dataset: {
          ...prev.dataset,
          steps: prev.dataset.steps.filter((_, i) => i !== index),
        } as FunnelDataset,
      } as ExplorationConfig;
    });
    setUiState((prev) => prev.filter((_, i) => i !== index));
  };

  const handleAddStep = () => {
    setDraftExploreState((prev) => {
      if (prev.dataset.type !== "funnel") return prev;
      const previousFactTable =
        prev.dataset.steps[prev.dataset.steps.length - 1]?.factTableId ?? "";
      // Default the new step's fact table to the previous step's — the most
      // common case. The picker is hidden on inherited steps, so the user
      // doesn't see a redundant select until they actively want to override.
      const newStep = createEmptyFunnelStep({
        name: `Step ${prev.dataset.steps.length + 1}`,
        factTableId: previousFactTable,
      });
      // Mirror handleFactTableChange in FunnelStepCard: any alwaysInlineFilter
      // columns on the inherited fact table get pre-seeded with empty values.
      const ft = previousFactTable ? getFactTableById(previousFactTable) : null;
      if (ft) {
        newStep.rowFilters = getInitialInlineFilters(ft, newStep.rowFilters);
      }
      return {
        ...prev,
        dataset: {
          ...prev.dataset,
          steps: [...prev.dataset.steps, newStep],
        } as FunnelDataset,
      } as ExplorationConfig;
    });
    // Auto-collapse every existing step that wasn't manually opened by the
    // user; the new step appends in its default (expanded, not-user-opened)
    // state. Steps the user explicitly expanded stay open until they
    // collapse them, matching the "locked open" intent.
    setInstantCollapseTransition(true);
    setUiState((prev) => {
      const collapsed = prev.map((s) =>
        s.userExpanded ? s : { ...s, collapsed: true },
      );
      return [...collapsed, { collapsed: false, userExpanded: false }];
    });
  };

  return (
    <Flex direction="column" gap="4">
      <Flex direction="column" gap="1">
        <SelectField
          label="Load from funnel metric"
          value={linkedFunnelMetricId ?? ""}
          onChange={handleLoadFunnelMetric}
          options={funnelMetricOptions}
          initialOption="None — build a new funnel"
          disabled={funnelMetricOptions.length === 0}
          helpText={
            funnelMetricOptions.length === 0
              ? "No saved funnel metrics on this data source yet."
              : "Loads the metric's steps. Editing them here doesn't change the metric."
          }
        />
        {linkedFunnelMetricId && funnelLinkIsDirty && (
          <Text size="sm" color="text-low">
            Edited since loading — the metric itself is unchanged.
          </Text>
        )}
      </Flex>
      {steps.map((step, index) => (
        <FunnelStepCard
          key={index}
          index={index}
          step={step}
          steps={steps}
          previousFactTable={
            index === 0 ? null : (steps[index - 1]?.factTableId ?? null)
          }
          isCollapsed={uiState[index]?.collapsed ?? false}
          onToggleCollapsed={() => handleToggleCollapsed(index)}
          onDelete={handleDelete}
          funnelUnitOptions={funnelUnitOptions}
          collapsibleTransitionMs={instantCollapseTransition ? 0 : 100}
        />
      ))}
      {allStepsHaveFactTable && funnelUnitOptions.length === 0 && (
        <Text size="sm" color="text-low">
          No shared user identifier across steps.
        </Text>
      )}
      <Button
        size="md"
        variant="outline"
        onClick={handleAddStep}
        disabled={steps.length >= MAX_FUNNEL_STEPS}
        title={
          steps.length >= MAX_FUNNEL_STEPS
            ? `Funnels are limited to ${MAX_FUNNEL_STEPS} steps.`
            : undefined
        }
      >
        <Flex align="center" gap="2">
          <PiPlus size={14} />
          Add step
        </Flex>
      </Button>
    </Flex>
  );
}

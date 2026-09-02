import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Flex } from "@radix-ui/themes";
import { PiFunnelBold, PiPlus } from "react-icons/pi";
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
import { Select, SelectItem, SelectSeparator } from "@/ui/Select";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useExplorerContext } from "@/enterprise/components/ProductAnalytics/ExplorerContext";
import {
  createEmptyFunnelStep,
  getFunnelUnitOptions,
  getInitialInlineFilters,
} from "@/enterprise/components/ProductAnalytics/util";
import Callout from "@/ui/Callout";
import FunnelStepCard from "./FunnelStepCard";

/**
 * Sentinel for the "Build a New Funnel" entry. A Radix Select needs every item
 * to carry a value, but this one is an action rather than a selection — it is
 * never written to state, so the trigger returns to the placeholder.
 */
const NEW_FUNNEL_VALUE = "__new_funnel__";

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

  // True when the sidebar should show the "No steps added yet" empty state
  // instead of step cards. Starts true for a blank funnel and flips to false
  // once the user clicks "Add a step" or loads a saved metric.
  const [emptyStateActive, setEmptyStateActive] = useState(() => {
    if (!isFunnel) return false;
    const initialSteps = (draftExploreState.dataset as FunnelDataset).steps;
    return !initialSteps.some((s) => !!s.factTableId);
  });

  const [uiState, setUiState] = useState<StepUiState[]>(() => {
    // When the page initializes from a URL/saved config, steps already
    // have fact tables and filters
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

  const funnelMetricOptions = useMemo(
    () =>
      factMetrics
        .filter(isFactFunnelMetric)
        .filter((m) => m.datasource === draftExploreState.datasource)
        .filter((m) => isProjectListValidForProject(m.projects, project))
        .map((m) => ({ label: m.name, value: m.id })),
    [factMetrics, draftExploreState.datasource, project],
  );

  const linkedFunnelMetricName =
    funnelMetricOptions.find((o) => o.value === linkedFunnelMetricId)?.label ??
    null;

  /**
   * Start over on a blank funnel, keeping the current data source.
   */
  const resetToNewFunnel = useCallback(() => {
    clearAllDatasets(draftExploreState.datasource);
    setInstantCollapseTransition(true);
    setUiState([{ collapsed: false, userExpanded: false }]);
    setEmptyStateActive(true);
  }, [clearAllDatasets, draftExploreState.datasource]);

  // Switching project clears the funnel outright — steps included, linked or not.
  const previousProjectRef = useRef(project);
  useEffect(() => {
    if (previousProjectRef.current === project) return;
    previousProjectRef.current = project;
    resetToNewFunnel();
  }, [project, resetToNewFunnel]);

  // prevents steps from presisting if switching orgs/datasources changes what fact tables are accessible
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
    setInstantCollapseTransition(true);
    setEmptyStateActive(false);
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
      <Flex
        direction="column"
        p="3"
        gap="3"
        style={{
          border: "1px solid var(--gray-a3)",
          borderRadius: "var(--radius-4)",
          backgroundColor: "var(--color-panel-translucent)",
        }}
      >
        <Select
          label="Funnel"
          labelSize="sm"
          placeholder="Select a funnel"
          // When linked to a metric that's in the list, show it. Otherwise
          // show "Build a New Funnel" for any configured funnel, and the
          // placeholder only for the initial empty state.
          value={
            linkedFunnelMetricName
              ? (linkedFunnelMetricId ?? undefined)
              : emptyStateActive
                ? undefined
                : NEW_FUNNEL_VALUE
          }
          setValue={(value) => {
            if (value === NEW_FUNNEL_VALUE) {
              // Already building a new funnel — only reset if switching
              // away from a linked metric.
              if (linkedFunnelMetricId) {
                resetToNewFunnel();
              }
              return;
            }
            handleLoadFunnelMetric(value);
          }}
        >
          {funnelMetricOptions.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              <Flex align="center" gap="2">
                <PiFunnelBold size={14} />
                {o.label}
              </Flex>
            </SelectItem>
          ))}
          {funnelMetricOptions.length > 0 && <SelectSeparator />}
          <SelectItem value={NEW_FUNNEL_VALUE}>
            <Flex align="center" gap="2">
              <PiPlus size={14} />
              Build a New Funnel
            </Flex>
          </SelectItem>
        </Select>
        {funnelMetricOptions.length > 0 && (
          <Callout status="info" size="sm">
            {linkedFunnelMetricId && funnelLinkIsDirty
              ? "Edited since loading — the metric itself is unchanged."
              : "Loads the metric's steps. Editing them here doesn't change the metric."}
          </Callout>
        )}
      </Flex>
      {emptyStateActive ? (
        <Flex align="center" justify="center" direction="column" gap="2" py="9">
          <Text size="lg" weight="semibold" align="center">
            No steps added yet
          </Text>
          <Text size="sm" color="text-mid" align="center">
            Add your first step to start building a funnel.
          </Text>
          <Button
            size="md"
            variant="solid"
            style={{ width: "100%" }}
            mt="2"
            onClick={() => {
              setEmptyStateActive(false);
              setUiState((prev) =>
                prev.map((s, i) =>
                  i === 0 ? { collapsed: false, userExpanded: true } : s,
                ),
              );
            }}
          >
            <Flex align="center" gap="2">
              <PiPlus size={14} />
              Add a step
            </Flex>
          </Button>
        </Flex>
      ) : (
        <>
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
        </>
      )}
    </Flex>
  );
}

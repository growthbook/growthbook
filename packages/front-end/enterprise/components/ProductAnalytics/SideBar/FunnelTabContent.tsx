import React, { useEffect, useMemo, useState } from "react";
import { Flex } from "@radix-ui/themes";
import { PiPlus } from "react-icons/pi";
import { ExplorationConfig, FunnelDataset } from "shared/validators";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
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
  } = useExplorerContext();
  const { getFactTableById, factTables } = useDefinitions();

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
    const hasConfiguredStep = initialSteps.some((s) => !!s.factTable);
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
    () => funnelDataset?.steps.map((s) => s.factTable ?? "").join("|") ?? "",
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

  const allStepsHaveFactTable = steps.every((s) => !!s.factTable);

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
        prev.dataset.steps[prev.dataset.steps.length - 1]?.factTable ?? "";
      // Default the new step's fact table to the previous step's — the most
      // common case. The picker is hidden on inherited steps, so the user
      // doesn't see a redundant select until they actively want to override.
      const newStep = createEmptyFunnelStep({
        name: `Step ${prev.dataset.steps.length + 1}`,
        factTable: previousFactTable,
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
      {steps.map((step, index) => (
        <FunnelStepCard
          key={index}
          index={index}
          step={step}
          steps={steps}
          previousFactTable={
            index === 0 ? null : (steps[index - 1]?.factTable ?? null)
          }
          isCollapsed={uiState[index]?.collapsed ?? false}
          onToggleCollapsed={() => handleToggleCollapsed(index)}
          onDelete={handleDelete}
          funnelUnitOptions={funnelUnitOptions}
          collapsibleTransitionMs={instantCollapseTransition ? 0 : 100}
        />
      ))}
      {allStepsHaveFactTable && funnelUnitOptions.length === 0 && (
        <Text size="small" color="text-low">
          No shared user identifier across steps.
        </Text>
      )}
      <Button size="sm" variant="outline" onClick={handleAddStep}>
        <Flex align="center" gap="2">
          <PiPlus size={14} />
          Add step
        </Flex>
      </Button>
    </Flex>
  );
}

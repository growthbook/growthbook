import { useMemo } from "react";
import { DashboardInterface } from "shared/enterprise";
import { useExperiments } from "@/hooks/useExperiments";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useExperimentFilterCategories } from "@/components/Search/experimentFilterCategories";
import { SearchFiltersItem } from "@/components/Search/SearchFilters";
import Tag from "@/components/Tags/Tag";
import DashboardChecklistFilter, {
  ChecklistOption,
} from "./DashboardChecklistFilter";
import {
  EXPERIMENT_CATEGORY_LABELS,
  EXPERIMENT_CATEGORY_SEARCH_PLACEHOLDERS,
} from "./dashboardFilterCatalog";
import {
  DashboardExperimentCategoryKey,
  getExperimentCategoryValues,
  setExperimentCategoryValues,
} from "./experimentSearchFilterString";

type GlobalControls = DashboardInterface["globalControls"];

interface Props {
  globalControls: GlobalControls;
  // Categories to render, in bar order. Never empty — the parent only mounts
  // this component when there is at least one, so the experiment list and filter
  // taxonomy aren't loaded for dashboards with no experiment filters.
  categories: DashboardExperimentCategoryKey[];
  // Category just added from the "Add filter" menu; its popover opens on mount.
  autoOpenCategory?: DashboardExperimentCategoryKey | null;
  // Restrict the Project options to the dashboard's projects (empty = all).
  projects: string[];
  disabled?: boolean;
  onChange: (
    category: DashboardExperimentCategoryKey,
    patch: Partial<NonNullable<GlobalControls>>,
  ) => void;
  // Clears the category and takes its pill out of the bar (the pill's ✕).
  onRemove: (
    category: DashboardExperimentCategoryKey,
    patch: Partial<NonNullable<GlobalControls>>,
  ) => void;
}

// The taxonomy uses `searchValue` as the persisted value and `name` (which may
// carry an icon) for display.
function toChecklistOptions(items: SearchFiltersItem[]): ChecklistOption[] {
  return items.map((item) => ({
    label: typeof item.name === "string" ? item.name : item.searchValue,
    node: typeof item.name === "string" ? undefined : item.name,
    value: item.searchValue,
    disabled: item.disabled,
  }));
}

/**
 * One pill per experiment filter category (Metrics filter, Result, Owner, …).
 * Each holds the same option list it had as a row in the old combined Experiment
 * Filters card, and they all persist into the single `experimentSearchString`.
 */
export default function DashboardExperimentCategoryPills({
  globalControls,
  categories,
  autoOpenCategory,
  projects,
  disabled,
  onChange,
  onRemove,
}: Props) {
  const { experiments } = useExperiments();
  const { projects: allProjects } = useDefinitions();
  const {
    availableTags,
    metricItems,
    owners,
    resultItems,
    statusItems,
    typeItems,
  } = useExperimentFilterCategories({ experiments });

  const optionsByCategory = useMemo<
    Record<DashboardExperimentCategoryKey, ChecklistOption[]>
  >(
    () => ({
      // Persist the project id, not the name: both the server and client search
      // match `project:` against either, and an id survives a rename. Same
      // trade-off the metric taxonomy already makes.
      project: (projects.length > 0
        ? allProjects.filter((p) => projects.includes(p.id))
        : allProjects
      ).map((p) => ({ label: p.name, value: p.id })),
      metric: toChecklistOptions(metricItems),
      is: toChecklistOptions(resultItems),
      owner: owners.map((owner) => ({ label: owner, value: owner })),
      status: toChecklistOptions(statusItems),
      tag: availableTags.map((tag) => ({
        label: tag,
        value: tag,
        node: <Tag tag={tag} key={tag} skipMargin variant="dot" />,
      })),
      has: toChecklistOptions(typeItems),
    }),
    [
      allProjects,
      projects,
      metricItems,
      resultItems,
      owners,
      statusItems,
      availableTags,
      typeItems,
    ],
  );

  const searchString = globalControls?.experimentSearchString;

  return (
    <>
      {categories.map((category) => (
        <DashboardChecklistFilter
          key={category}
          label={EXPERIMENT_CATEGORY_LABELS[category]}
          autoOpen={autoOpenCategory === category}
          options={optionsByCategory[category]}
          value={getExperimentCategoryValues(searchString, category)}
          onChange={(values) =>
            onChange(category, {
              experimentSearchString:
                setExperimentCategoryValues(searchString, category, values) ||
                undefined,
            })
          }
          onRemove={() =>
            onRemove(category, {
              experimentSearchString:
                setExperimentCategoryValues(searchString, category, []) ||
                undefined,
            })
          }
          disabled={disabled}
          searchPlaceholder={EXPERIMENT_CATEGORY_SEARCH_PLACEHOLDERS[category]}
          emptyText="No options"
        />
      ))}
    </>
  );
}

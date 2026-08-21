import { useMemo } from "react";
import { DashboardInterface } from "shared/enterprise";
import { useDefinitions } from "@/services/DefinitionsContext";
import DashboardChecklistFilter, {
  ChecklistOption,
} from "./DashboardChecklistFilter";
import DashboardExperimentCategoryPills from "./DashboardExperimentCategoryPills";
import {
  DashboardOptionalFilterKey,
  getExperimentCategory,
} from "./dashboardFilterCatalog";
import { DashboardExperimentCategoryKey } from "./experimentSearchFilterString";

type GlobalControls = DashboardInterface["globalControls"];

interface Props {
  globalControls: GlobalControls;
  // Filters to render, in bar order.
  visibleKeys: DashboardOptionalFilterKey[];
  // Filter just added from the "Add filter" menu — its popover opens on mount so
  // the user can pick a value straight away.
  autoOpenKey?: DashboardOptionalFilterKey | null;
  disabled?: boolean;
  // Restrict project options to the dashboard's projects (empty = all).
  projects: string[];
  // Reports which filter changed alongside the patch, so the bar can keep a
  // touched pill visible even once the user clears its last value.
  onChange: (
    key: DashboardOptionalFilterKey,
    patch: Partial<NonNullable<GlobalControls>>,
  ) => void;
  // Clears the filter's value and takes it out of the bar (the pill's ✕).
  onRemove: (
    key: DashboardOptionalFilterKey,
    patch: Partial<NonNullable<GlobalControls>>,
  ) => void;
}

/**
 * The filter pills in the dashboard filter bar (everything except the permanent
 * Date Range control). Each pill holds the same contents it had in the old
 * combined filter card; the experiment filter categories are split into one pill
 * each and rendered after the dashboard's own Projects filter.
 */
export default function DashboardFilterPills({
  globalControls,
  visibleKeys,
  autoOpenKey,
  disabled,
  projects,
  onChange,
  onRemove,
}: Props) {
  const { projects: allProjects } = useDefinitions();

  const experimentCategories = useMemo(
    () =>
      visibleKeys
        .map(getExperimentCategory)
        .filter((c): c is DashboardExperimentCategoryKey => c !== null),
    [visibleKeys],
  );

  // Projects ------------------------------------------------------------------
  const projectOptions: ChecklistOption[] = useMemo(
    () =>
      (projects.length > 0
        ? allProjects.filter((p) => projects.includes(p.id))
        : allProjects
      ).map((p) => ({ label: p.name, value: p.id })),
    [allProjects, projects],
  );

  const autoOpenCategory = autoOpenKey
    ? getExperimentCategory(autoOpenKey)
    : null;

  return (
    <>
      {visibleKeys.includes("projects") ? (
        <DashboardChecklistFilter
          label="Projects"
          autoOpen={autoOpenKey === "projects"}
          options={projectOptions}
          value={globalControls?.projects ?? []}
          onChange={(v) => onChange("projects", { projects: v })}
          onRemove={() => onRemove("projects", { projects: undefined })}
          disabled={disabled}
          searchPlaceholder="Search projects..."
          emptyText="No projects found"
        />
      ) : null}

      {experimentCategories.length > 0 ? (
        <DashboardExperimentCategoryPills
          globalControls={globalControls}
          categories={experimentCategories}
          autoOpenCategory={autoOpenCategory}
          disabled={disabled}
          onChange={(category, patch) => onChange(`exp:${category}`, patch)}
          onRemove={(category, patch) => onRemove(`exp:${category}`, patch)}
        />
      ) : null}
    </>
  );
}

import { useMemo } from "react";
import { DashboardInterface } from "shared/enterprise";
import DashboardExperimentCategoryPills from "./DashboardExperimentCategoryPills";
import {
  DashboardOptionalFilterKey,
  getExperimentCategory,
} from "./dashboardFilterCatalog";

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
 * Date Range control). Every pill is an experiment filter category — Projects
 * included — so they all persist into the single `experimentSearchString`.
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
  const categories = useMemo(
    () => visibleKeys.map(getExperimentCategory),
    [visibleKeys],
  );

  if (categories.length === 0) return null;

  return (
    <DashboardExperimentCategoryPills
      globalControls={globalControls}
      categories={categories}
      autoOpenCategory={autoOpenKey ? getExperimentCategory(autoOpenKey) : null}
      projects={projects}
      disabled={disabled}
      onChange={(category, patch) => onChange(`exp:${category}`, patch)}
      onRemove={(category, patch) => onRemove(`exp:${category}`, patch)}
    />
  );
}

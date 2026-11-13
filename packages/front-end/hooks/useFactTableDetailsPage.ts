import { useEffect } from "react";
import { useRouter } from "next/router";
import { FactTableInterface } from "shared/types/fact-table";
import { getFactMetricFactTableIds } from "shared/experiments";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import useApi from "@/hooks/useApi";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";

// Fact tables managed outside the UI can't be edited or deleted here
const LOCKED_MANAGERS = ["api", "dbt", "config"];

// The one controller for a fact table page: loading, the full fact table, its
// metrics and data source, and what the viewer may do. Both the legacy and the
// redesigned page render from it.
export default function useFactTableDetailsPage() {
  const router = useRouter();
  const { ftid } = router.query;
  const permissionsUtil = usePermissionsUtil();
  const { hasCommercialFeature } = useUser();
  const {
    getFactTableById,
    ready,
    _factMetricsIncludingArchived: factMetrics,
    getDatasourceById,
  } = useDefinitions();

  // Definitions only contain a slimmed fact table (no sql or per-column
  // jsonFields), so fetch the full version for this page
  const factTableDefinition = getFactTableById(ftid as string);
  const {
    data,
    error,
    mutate: mutateFactTable,
  } = useApi<{ factTable: FactTableInterface }>(`/fact-tables/${ftid}`, {
    shouldRun: () => !!ftid,
  });

  // Child modals refresh definitions after saving; cascade that to the full
  // fact table fetch. Keyed off the whole definition because background column
  // refreshes update columns without bumping dateUpdated.
  useEffect(() => {
    mutateFactTable();
  }, [factTableDefinition, mutateFactTable]);

  if (!ready || (!data && !error)) return { status: "loading" as const };
  const factTable = data?.factTable;
  if (!factTable) return { status: "missing" as const };

  const metrics = factMetrics.filter((m) =>
    getFactMetricFactTableIds(m).includes(factTable.id),
  );
  const datasource = getDatasourceById(factTable.datasource);
  const locked =
    !!factTable.managedBy && LOCKED_MANAGERS.includes(factTable.managedBy);
  const canEdit =
    !locked && permissionsUtil.canUpdateFactTable(factTable, factTable);
  const pipelineSettings = datasource?.settings?.pipelineSettings;

  return {
    status: "ready" as const,
    factTable,
    metrics,
    datasource,
    canEdit,
    canDelete: !locked && permissionsUtil.canDeleteFactTable(factTable),
    canDuplicate: permissionsUtil.canCreateFactTable({
      projects: factTable.projects,
    }),
    canOpenInExplorer: datasource
      ? permissionsUtil.canRunFactQueries(datasource)
      : false,
    // Editing columns is less restrictive than editing the whole fact table
    canEditColumns: permissionsUtil.canUpdateFactTable(factTable, {
      columns: [],
    }),
    canManageOfficial:
      canEdit &&
      permissionsUtil.canCreateOfficialResources(factTable) &&
      hasCommercialFeature("manage-official-resources"),
    canEditAggregatedSettings:
      canEdit &&
      hasCommercialFeature("pipeline-mode") &&
      pipelineSettings?.allowWriting === true &&
      pipelineSettings?.mode === "incremental" &&
      !!datasource &&
      permissionsUtil.canUpdateDataSourceSettings(datasource),
  };
}

export type FactTablePageData = Extract<
  ReturnType<typeof useFactTableDetailsPage>,
  { status: "ready" }
>;

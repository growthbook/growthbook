import {
  FactFilterInterface,
  FactTableInterface,
} from "shared/types/fact-table";
import { useState } from "react";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import FactFilterModal from "@/components/FactTables/FactFilterModal";

// The one editing controller for a fact table's Saved Filters: permissions,
// which filter is open, and the editor modal. Lists only render rows.
export default function useFactFilterEditor(factTable: FactTableInterface) {
  const [editOpen, setEditOpen] = useState("");
  const [newOpen, setNewOpen] = useState(false);

  const permissionsUtil = usePermissionsUtil();
  const canCreate = permissionsUtil.canCreateAndUpdateFactFilter(factTable);
  const canDelete = permissionsUtil.canDeleteFactFilter(factTable);

  const modal = newOpen ? (
    <FactFilterModal close={() => setNewOpen(false)} factTable={factTable} />
  ) : editOpen ? (
    <FactFilterModal
      close={() => setEditOpen("")}
      factTable={factTable}
      existing={factTable.filters.find((f) => f.id === editOpen)}
      canDelete={canDelete}
    />
  ) : null;

  return {
    canCreate,
    // Filters managed outside the UI (API, dbt, config) can't be edited here
    canEdit: (filter: FactFilterInterface) => canCreate && !filter.managedBy,
    openNew: () => setNewOpen(true),
    openEdit: (filter: FactFilterInterface) => setEditOpen(filter.id),
    modal,
  };
}

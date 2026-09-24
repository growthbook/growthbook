import { Flex } from "@radix-ui/themes";
import { FactTableInterface, RowFilter } from "shared/types/fact-table";
import { useMemo, useState } from "react";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { factTableToColumnSource, isRowFilterComplete } from "./rowFilterUtils";
import { RowFilterEditorRows } from "./RowFilterFields";
import { RowFilterActions } from "./RowFilterActions";
import { SampleRowsModal } from "./SampleRowsModal";

export function RowFilterInput({
  value,
  setValue,
  factTable,
}: {
  value: RowFilter[];
  setValue: (value: RowFilter[]) => void;
  factTable: Pick<
    FactTableInterface,
    "id" | "columns" | "filters" | "userIdTypes"
  >;
}) {
  const [sampleRowsOpen, setSampleRowsOpen] = useState(false);
  const { getFactTableById, getDatasourceById } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();
  const columnSource = useMemo(
    () => factTableToColumnSource(factTable),
    [factTable],
  );

  const datasource = getDatasourceById(
    getFactTableById(factTable.id)?.datasource || "",
  );
  const showSampleRows =
    !!datasource && permissionsUtil.canRunTestQueries(datasource);

  return (
    <Flex direction="column" gap="2">
      <strong>Row Filter</strong>
      {sampleRowsOpen && (
        <SampleRowsModal
          factTableId={factTable.id}
          rowFilters={value}
          setRowFilters={setValue}
          close={() => setSampleRowsOpen(false)}
        />
      )}
      <RowFilterEditorRows
        value={value}
        setValue={setValue}
        columnSource={columnSource}
        dateInputWidth={260}
      />
      <RowFilterActions
        onAdd={(filter) => setValue([...value, filter])}
        onViewSampleRows={
          showSampleRows ? () => setSampleRowsOpen(true) : undefined
        }
        canViewSampleRows={value.every(isRowFilterComplete)}
      />
    </Flex>
  );
}

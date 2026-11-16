import { Flex } from "@radix-ui/themes";
import { FactTableInterface, RowFilter } from "shared/types/fact-table";
import { useMemo, useState } from "react";
import { PiTable } from "react-icons/pi";
import Button from "@/ui/Button";
import Text from "@/ui/Text";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useDefinitions } from "@/services/DefinitionsContext";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { factTableToColumnSource, isRowFilterComplete } from "./rowFilterUtils";
import { RowFilterEditorRows } from "./RowFilterFields";
import { RowFilterActions } from "./RowFilterActions";
import { SampleRowsModal } from "./SampleRowsModal";

export function SampleRowsButton({
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

  const datasource = getDatasourceById(
    getFactTableById(factTable.id)?.datasource || "",
  );
  const canShowSampleRows =
    !!datasource && permissionsUtil.canRunTestQueries(datasource);
  const canViewSampleRows = value.every(isRowFilterComplete);

  return (
    <>
      {canShowSampleRows && (
        <Tooltip
          shouldDisplay={!canViewSampleRows}
          body="Fill out all filters first"
        >
          <Button
            size="sm"
            variant="ghost"
            disabled={!canViewSampleRows}
            icon={<PiTable size={14} />}
            onClick={() => setSampleRowsOpen(true)}
          >
            View sample rows
          </Button>
        </Tooltip>
      )}
      {canShowSampleRows && sampleRowsOpen && (
        <SampleRowsModal
          factTableId={factTable.id}
          rowFilters={value}
          setRowFilters={setValue}
          close={() => setSampleRowsOpen(false)}
        />
      )}
    </>
  );
}

export function RowFilterInput({
  value,
  setValue,
  factTable,
  hideSampleRows = false,
}: {
  hideSampleRows?: boolean;
  value: RowFilter[];
  setValue: (value: RowFilter[]) => void;
  factTable: Pick<
    FactTableInterface,
    "id" | "columns" | "filters" | "userIdTypes"
  >;
}) {
  const columnSource = useMemo(
    () => factTableToColumnSource(factTable),
    [factTable],
  );

  return (
    <Flex direction="column" gap="2">
      <Flex align="center" justify="between" gap="2">
        <Text weight="semibold">Row filter</Text>
        {!hideSampleRows && (
          <SampleRowsButton
            factTable={factTable}
            value={value}
            setValue={setValue}
          />
        )}
      </Flex>
      <RowFilterEditorRows
        key={factTable.id}
        value={value}
        setValue={setValue}
        columnSource={columnSource}
        dateInputWidth={260}
      />
      <RowFilterActions onAdd={(filter) => setValue([...value, filter])} />
    </Flex>
  );
}

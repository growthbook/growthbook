import { useState } from "react";
import {
  ColumnInterface,
  FactTableColumnType,
  FactTableInterface,
  NumberFormat,
  UpdateColumnProps,
} from "shared/types/fact-table";
import { useUser } from "@/services/UserContext";
import useSaveFactTableColumn from "@/hooks/useSaveFactTableColumn";
import {
  COLUMN_DATATYPE_OPTIONS,
  getColumnEligibility,
  getColumnRole,
  NUMBER_FORMAT_OPTIONS,
} from "@/services/columnEditModel";
import { TextField } from "@/ui/TextField";
import SelectField from "@/components/Forms/SelectField";
import Checkbox from "@/ui/Checkbox";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Text from "@/ui/Text";

// Edits one physical column on the redesigned page: the column-edit model's
// settings that apply to the column's type and role. ColumnModal adds the
// advanced ones.
export default function EditColumnModal({
  factTable,
  column,
  close,
}: {
  factTable: FactTableInterface;
  column: ColumnInterface;
  close: () => void;
}) {
  const saveColumn = useSaveFactTableColumn(factTable);
  const { hasCommercialFeature } = useUser();

  const [description, setDescription] = useState(column.description || "");
  const [datatype, setDatatype] = useState<FactTableColumnType>(
    column.datatype,
  );
  const [numberFormat, setNumberFormat] = useState<NumberFormat>(
    column.numberFormat || "",
  );
  const [filter, setFilter] = useState(!!column.alwaysInlineFilter);
  const [autoSlice, setAutoSlice] = useState(!!column.isAutoSliceColumn);

  // The mapping roles are set in the SQL, so they replace the other settings
  const role = getColumnRole(factTable, column.column);
  const eligibility = getColumnEligibility(factTable, { ...column, datatype });
  const canFilter = eligibility.canFilter;
  const canAutoSlice =
    eligibility.canAutoSlice && hasCommercialFeature("metric-slices");

  return (
    <ModalStandard
      trackingEventModalType=""
      open={true}
      close={close}
      header="Edit Column"
      subheader={column.column}
      cta="Save"
      submit={async () => {
        const data: UpdateColumnProps = { description };
        if (!column.datatype) data.datatype = datatype;
        if (datatype === "number") data.numberFormat = numberFormat;
        if (canFilter) data.alwaysInlineFilter = filter;
        if (canAutoSlice) data.isAutoSliceColumn = autoSlice;
        await saveColumn(column, data);
      }}
    >
      <TextField
        label="Description"
        placeholder="What this column holds"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />

      {!column.datatype && (
        <SelectField
          label="Data type"
          value={datatype}
          onChange={(v) => setDatatype(v as FactTableColumnType)}
          initialOption="Unknown"
          sort={false}
          options={COLUMN_DATATYPE_OPTIONS}
        />
      )}

      {role ? (
        <Text as="p" color="text-mid">
          This column is the {role} for this fact table. That mapping is set in
          the SQL.
        </Text>
      ) : datatype === "json" ? (
        <Text as="p" color="text-mid">
          JSON fields are detected from recent rows on each refresh.
        </Text>
      ) : datatype === "number" ? (
        <SelectField
          label="Number format"
          value={numberFormat}
          onChange={(v) => setNumberFormat(v as NumberFormat)}
          sort={false}
          options={NUMBER_FORMAT_OPTIONS}
        />
      ) : null}

      {canFilter && (
        <Checkbox
          label="Filter: always ask for a value when creating metrics"
          value={filter}
          setValue={(v) => setFilter(v === true)}
          mb="3"
        />
      )}
      {canAutoSlice && (
        <Checkbox
          label="Auto Slice: break experiment results down by this column"
          value={autoSlice}
          setValue={(v) => setAutoSlice(v === true)}
        />
      )}
    </ModalStandard>
  );
}

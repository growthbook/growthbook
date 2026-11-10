import { useState } from "react";
import {
  ColumnInterface,
  FactTableColumnType,
  FactTableInterface,
  NumberFormat,
  UpdateColumnProps,
} from "shared/types/fact-table";
import {
  canInlineFilterColumn,
  getFactTableIdColumn,
  getFactTableTimestampColumn,
} from "shared/experiments";
import { useUser } from "@/services/UserContext";
import useSaveColumn from "@/hooks/useSaveColumn";
import Field from "@/components/Forms/Field";
import SelectField from "@/components/Forms/SelectField";
import Checkbox from "@/ui/Checkbox";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Text from "@/ui/Text";

// Edits one physical column on the redesigned page, showing only the settings
// that apply to its type and role. ColumnModal stays the full editor.
export default function EditColumnModal({
  factTable,
  column,
  close,
}: {
  factTable: FactTableInterface;
  column: ColumnInterface;
  close: () => void;
}) {
  const saveColumn = useSaveColumn(factTable);
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

  const isTimestamp = column.column === getFactTableTimestampColumn(factTable);
  const isIdentifier = factTable.userIdTypes.some(
    (idType) => getFactTableIdColumn(factTable, idType) === column.column,
  );
  // The mapping roles are set in the SQL, so they replace the other settings
  const role = isTimestamp ? "timestamp" : isIdentifier ? "identifier" : null;

  const canFilter = !role && canInlineFilterColumn(factTable, column.column);
  const canAutoSlice =
    !role &&
    (datatype === "string" || datatype === "boolean") &&
    hasCommercialFeature("metric-slices");

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
      <Field
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
          options={[
            { label: "Number", value: "number" },
            { label: "String", value: "string" },
            { label: "Date / Datetime", value: "date" },
            { label: "Boolean", value: "boolean" },
            { label: "JSON", value: "json" },
            { label: "Other", value: "other" },
          ]}
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
          options={[
            { label: "Plain number", value: "" },
            { label: "Currency", value: "currency" },
            { label: "Time (seconds)", value: "time:seconds" },
            { label: "Time (milliseconds)", value: "time:milliseconds" },
            { label: "Memory (bytes)", value: "memory:bytes" },
            { label: "Memory (kilobytes)", value: "memory:kilobytes" },
          ]}
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

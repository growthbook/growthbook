import { InformationSchemaTablesInterface } from "@/../back-end/src/types/Integration";
import useApi from "@/hooks/useApi";
import TypeaheadInput from "./TypeaheadInput";

type Props = {
  datasourceId: string;
  tableId: string;
  value: string;
  onChange: (e: string) => void;
  placeholder?: string;
  label?: string;
};

export default function ColumnInput({
  datasourceId,
  tableId,
  value,
  onChange,
  label,
  placeholder,
}: Props) {
  const items = [];
  const { data } = useApi<{
    table: InformationSchemaTablesInterface;
  }>(`/datasource/${datasourceId}/schema/table/${tableId}`);

  if (data?.table?.columns.length) {
    data.table.columns.forEach((column) => {
      items.push({ name: column.columnName, id: "" });
    });
  }

  return (
    <TypeaheadInput
      label={label}
      value={value}
      items={items}
      onChange={onChange}
      placeholder={placeholder}
    />
  );
}

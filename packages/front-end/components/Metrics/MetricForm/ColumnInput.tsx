import { InformationSchemaTablesInterface } from "@/../back-end/src/types/Integration";
import { useRef, useState } from "react";
import CreatableSelect from "react-select/creatable";
import useApi from "@/hooks/useApi";

type Props = {
  datasourceId: string;
  tableId: string;
  currentValue: string;
  onChange: (e: string) => void;
  placeholder?: string;
  label?: string;
};

export default function ColumnInput({
  datasourceId,
  tableId,
  currentValue,
  onChange,
  label,
  placeholder,
}: Props) {
  const [inputValue, setInputValue] = useState("");
  const items: { label: string; value: string }[] = [];

  const inputRef = useRef(null);

  const { data } = useApi<{
    table: InformationSchemaTablesInterface;
  }>(`/datasource/${datasourceId}/schema/table/${tableId}`);

  if (data?.table?.columns.length) {
    data.table.columns.forEach((column) => {
      items.push({
        label: column.columnName,
        value: column.columnName,
      });
    });
  }

  function currentOption(): { label: string; value: string } | undefined {
    if (!currentValue) return undefined;

    return (
      items.find((item) => item.label === currentValue) || {
        label: currentValue,
        value: "",
      }
    );
  }

  return (
    <>
      <label>{label}</label>
      <CreatableSelect
        ref={inputRef}
        isClearable
        placeholder={placeholder}
        inputValue={inputValue}
        options={
          items.map((t) => {
            return {
              value: t.value,
              label: t.label,
            };
          }) ?? []
        }
        onChange={(val: { label: string; value: string }) => {
          if (!val) {
            onChange("");
          } else {
            onChange(val.label);
          }
        }}
        onBlur={() => {
          if (!inputValue) return;
          const currentItem = items.find(
            (item) => item.label === inputValue
          ) || {
            label: inputValue,
            value: "",
          };
          onChange(currentItem.label);
        }}
        onInputChange={(val) => {
          setInputValue(val);
        }}
        onKeyDown={(event) => {
          if (!inputValue) return;
          const currentItem = items.find(
            (item) => item.label === inputValue
          ) || {
            label: inputValue,
            value: "",
          };
          switch (event.key) {
            case "Enter":
            case "Tab":
            case " ":
              onChange(currentItem.label);
              setInputValue("");
              inputRef.current.blur();
              event.preventDefault();
          }
        }}
        onCreateOption={(val) => {
          onChange(val);
        }}
        value={currentOption()}
      />
    </>
  );
}

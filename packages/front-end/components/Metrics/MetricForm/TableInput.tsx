import { InformationSchemaInterface } from "@/../back-end/src/types/Integration";
import CreatableSelect from "react-select/creatable";
import { useRef, useState } from "react";
import useApi from "@/hooks/useApi";

type Props = {
  datasourceId: string;
  currentValue: string;
  onChange: (label: string, value: string) => void;
  label: string;
};

export default function TableInput({
  datasourceId,
  currentValue,
  onChange,
  label,
}: Props) {
  const [inputValue, setInputValue] = useState("");
  const items: { label: string; value: string }[] = [];

  const inputRef = useRef(null);

  //TODO: Can I change this so instead of using the hook, I just call it and wrap it with useMemo?
  const { data } = useApi<{
    informationSchema: InformationSchemaInterface;
  }>(`/datasource/${datasourceId}/schema`);

  if (data?.informationSchema?.databases.length) {
    data.informationSchema.databases.forEach((database) => {
      database.schemas.forEach((schema) => {
        schema.tables.forEach((table) => {
          items.push({ label: table.tableName, value: table.id });
        });
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
        inputValue={inputValue}
        placeholder="Enter a table name"
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
            onChange("", "");
          } else {
            onChange(val.label, val.value);
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
          onChange(currentItem.label, currentItem.value);
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
              onChange(currentItem.label, currentItem.value);
              setInputValue("");
              inputRef.current.blur();
              event.preventDefault();
          }
        }}
        onCreateOption={(val) => {
          onChange(val, "");
        }}
        value={currentOption()}
      />
    </>
  );
}

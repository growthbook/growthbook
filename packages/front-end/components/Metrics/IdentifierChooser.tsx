import SelectField from "@/components/Forms/SelectField";
import { useDefinitions } from "@/services/DefinitionsContext";
import React from "react";

export interface Props {
  value: string;
  setValue: (value: string) => void;
  factTableId: string;

  labelClassName?: string;
}

export default function IdentifierChooser({
  value,
  setValue,
  factTableId,

  labelClassName,
}: Props) {

  const { getFactTableById } = useDefinitions();
  const factTable = getFactTableById(factTableId);

  if (!factTable) {
    return null;
  }
  return (
    <div>
      <div className="uppercase-title text-muted">Aggregation Unit</div>
      <SelectField
        labelClassName={labelClassName}
        containerClassName={"select-dropdown-underline"}
        options={factTable.userIdTypes.map((d) => 
          {
            return {label: d, value: d};
          }
        )}
        formatOptionLabel={({ value, label }) => {
          return <code>{`${label}`}</code>
        }}
        value={value}
        onChange={(v) => {
          if (v === value) return;
          setValue(v);
        }}
      />
    </div>
  );
}

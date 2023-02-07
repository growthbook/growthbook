import { FC } from "react";
import { useDefinitions } from "../services/DefinitionsContext";
import MultiSelectField from "./Forms/MultiSelectField";

const GroupsInput: FC<{
  onChange: (groups: string[]) => void;
  value: string[];
}> = ({ onChange, value }) => {
  const { groups } = useDefinitions();

  return (
    <MultiSelectField
      id="groups-input"
      placeholder="Groups..."
      value={value}
      options={groups.map((group) => {
        return {
          label: group,
          value: group,
        };
      })}
      onChange={(value: string[]) => {
        value.map((t) => groups.push(t));
        onChange(value.filter((t) => t.length > 0));
      }}
      closeMenuOnSelect={true}
      autoFocus={true}
      creatable={true}
    />
  );
};

export default GroupsInput;

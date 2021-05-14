import { FC } from "react";
import { Typeahead } from "react-bootstrap-typeahead";
import { useDefinitions } from "../services/DefinitionsContext";

const GroupsInput: FC<{
  onChange: (groups: string[]) => void;
  value: string[];
}> = ({ onChange, value }) => {
  const { groups } = useDefinitions();

  return (
    <Typeahead
      id="groups-input"
      newSelectionPrefix="New Group: "
      labelKey="name"
      multiple={true}
      allowNew={true}
      options={groups.map((group) => {
        return {
          id: group,
          name: group,
        };
      })}
      onChange={(selected: { id: string; name: string }[]) => {
        onChange(selected.map((s) => s.name).filter((t) => t.length > 0));
      }}
      selected={value.map((v) => {
        return { id: v, name: v };
      })}
      placeholder="Groups..."
    />
  );
};

export default GroupsInput;

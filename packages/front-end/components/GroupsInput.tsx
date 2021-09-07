import { FC } from "react";
import { Typeahead } from "react-bootstrap-typeahead";
import { UseFormReturn } from "react-hook-form";
import { useDefinitions } from "../services/DefinitionsContext";

const GroupsInput: FC<{
  // eslint-disable-next-line
  form: UseFormReturn<any>;
  name: string;
}> = ({ form, name }) => {
  const { groups } = useDefinitions();

  const value = form.watch(name);

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
        form.setValue(
          name,
          selected.map((s) => s.name).filter((t) => t.length > 0)
        );
      }}
      selected={value.map((v) => {
        return { id: v, name: v };
      })}
      placeholder="Groups..."
    />
  );
};

export default GroupsInput;

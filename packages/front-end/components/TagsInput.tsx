import { FC } from "react";
import { Typeahead } from "react-bootstrap-typeahead";
import { UseFormReturn } from "react-hook-form";
import { useDefinitions } from "../services/DefinitionsContext";

const TagsInput: FC<{
  // eslint-disable-next-line
  form: UseFormReturn<any>;
  name: string;
}> = ({ form, name }) => {
  const { tags } = useDefinitions();

  const value = form.watch(name);

  return (
    <Typeahead
      id="tags-input"
      newSelectionPrefix="New Tag: "
      labelKey="name"
      multiple={true}
      allowNew={true}
      options={tags.map((tag) => {
        return {
          id: tag,
          name: tag,
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
      placeholder="Tags..."
    />
  );
};

export default TagsInput;

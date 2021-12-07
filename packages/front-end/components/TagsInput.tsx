import { FC } from "react";
import { Typeahead } from "react-bootstrap-typeahead";
import { useDefinitions } from "../services/DefinitionsContext";

const TagsInput: FC<{
  onChange: (tags: string[]) => void;
  value: string[];
}> = ({ onChange, value }) => {
  const { tags } = useDefinitions();

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
        onChange(selected.map((s) => s.name).filter((t) => t.length > 0));
      }}
      selected={value.map((v) => {
        return { id: v, name: v };
      })}
      placeholder="Tags..."
      positionFixed={true}
    />
  );
};

export default TagsInput;

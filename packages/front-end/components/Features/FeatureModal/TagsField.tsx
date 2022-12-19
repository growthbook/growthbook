import { FC } from "react";
import TagsInput from "@/components/Tags/TagsInput";

const TagsField: FC<{
  value: string[];
  onChange: (tags: string[]) => void;
}> = ({ value, onChange }) => {
  return (
    <div className="form-group">
      <label>Tags</label>
      <TagsInput value={value} onChange={onChange} />
    </div>
  );
};

export default TagsField;

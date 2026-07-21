import { FC } from "react";
import TagsInput from "@/components/Tags/TagsInput";

const TagsField: FC<{
  value: string[];
  onChange: (tags: string[]) => void;
  autoFocus?: boolean;
}> = ({ value, onChange, autoFocus = false }) => {
  return (
    <div className="form-group" style={{ width: "100%" }}>
      <label>Tags</label>
      <TagsInput value={value} onChange={onChange} autoFocus={autoFocus} />
    </div>
  );
};

export default TagsField;

import { FC, useState } from "react";
import TagsInput from "@/components/Tags/TagsInput";
import Link from "@/ui/Link";

const TagsField: FC<{
  value: string[];
  onChange: (tags: string[]) => void;
}> = ({ value, onChange }) => {
  const [expanded, setExpanded] = useState(value.length > 0);

  if (!expanded) {
    return (
      <div className="form-group">
        <Link onClick={() => setExpanded(true)}>+ tags</Link>
      </div>
    );
  }

  return (
    <div className="form-group">
      <label>Tags</label>
      <TagsInput
        value={value}
        onChange={onChange}
        autoFocus={value.length === 0}
      />
    </div>
  );
};

export default TagsField;

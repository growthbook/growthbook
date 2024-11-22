import { FC } from "react";
import SelectField, {
  SingleValue,
  GroupedValue,
} from "@/components/Forms/SelectField";

const ProjectSelectField: FC<{
  onChange: (v?: string) => void;
  value: string;
  placeholder: string;
  options: (SingleValue | GroupedValue)[];
}> = ({ onChange, value, options }) => {
  return (
    <SelectField
      label="Project"
      value={value}
      onChange={onChange}
      placeholder="Select Type..."
      options={options}
      required={false}
      sort={false}
    />
  );
};

export default ProjectSelectField;

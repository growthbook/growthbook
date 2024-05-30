import MultiSelectField from "@/components/Forms/MultiSelectField";
import { useDefinitions } from "@/services/DefinitionsContext";

export default function ProjectsMultiSelect({
  value,
  disabled,
  helpText,
  onChange,
  permissionFilter,
  label = "Projects",
}: {
  value: string[];
  permissionFilter: (projectId: string) => boolean;
  onChange: (value: string[]) => void;
  disabled?: boolean;
  helpText?: string;
  label?: string;
}) {
  const { projects } = useDefinitions();
  const validProjects = projects.filter((project) =>
    permissionFilter(project.id)
  );
  const options = validProjects.map((p) => ({ value: p.id, label: p.name }));

  return (
    <MultiSelectField
      label={label}
      placeholder="All projects"
      value={value}
      options={options}
      onChange={(value) => onChange(value)}
      customClassName="label-overflow-ellipsis"
      helpText={helpText}
      disabled={disabled}
    />
  );
}

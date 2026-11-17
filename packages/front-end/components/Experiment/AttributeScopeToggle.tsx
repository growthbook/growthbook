import clsx from "clsx";
import { PiFunnel } from "react-icons/pi";
import FieldIndicator from "@/ui/FieldIndicator";
import { useDefinitions } from "@/services/DefinitionsContext";

export default function AttributeScopeToggle({
  allProjects,
  setAllProjects,
  scopeProjects,
}: {
  allProjects: boolean;
  setAllProjects: (v: boolean) => void;
  scopeProjects?: string[] | null;
}) {
  const { getProjectById } = useDefinitions();

  const scopeNames = (scopeProjects ?? []).map(
    (id) => getProjectById(id)?.name || id,
  );
  const scopeLabel = allProjects
    ? "All Projects"
    : scopeNames.join(", ") || "the current project scope";
  const scopePrefix = allProjects
    ? ""
    : scopeNames.length > 1
      ? "Projects: "
      : "Project: ";

  return (
    <FieldIndicator
      label={`Showing attributes for ${scopePrefix}${scopeLabel}`}
      tooltip={
        <>
          Showing attributes for {scopePrefix}
          <strong>{scopeLabel}</strong>
        </>
      }
      onClick={() => setAllProjects(!allProjects)}
      className={clsx("gb-select__toggle", {
        "gb-select__toggle--on": !allProjects,
      })}
      aria-pressed={!allProjects}
    >
      <PiFunnel />
    </FieldIndicator>
  );
}

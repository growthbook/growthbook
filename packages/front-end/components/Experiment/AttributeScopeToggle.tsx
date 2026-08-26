import clsx from "clsx";
import { PiFunnel } from "react-icons/pi";
import Tooltip from "@/ui/Tooltip";
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

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setAllProjects(!allProjects);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <Tooltip
      content={
        <>
          Showing attributes for {scopePrefix}
          <strong>{scopeLabel}</strong>
        </>
      }
    >
      <button
        type="button"
        className={clsx("gb-select__scope-toggle", {
          "gb-select__scope-toggle--filtering": !allProjects,
        })}
        aria-label={`Showing attributes for ${scopePrefix}${scopeLabel}`}
        aria-pressed={!allProjects}
        onClick={handleClick}
        onMouseDown={handleMouseDown}
      >
        <PiFunnel />
      </button>
    </Tooltip>
  );
}

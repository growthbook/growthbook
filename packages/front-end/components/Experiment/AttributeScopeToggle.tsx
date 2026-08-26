import clsx from "clsx";
import { PiFunnel } from "react-icons/pi";
import Tooltip from "@/ui/Tooltip";
import { useDefinitions } from "@/services/DefinitionsContext";

// Mini icon button rendered inside attribute selects (via SelectField's
// `extraIndicator` slot): toggles the experiment's persisted attribute scope
// between its own projects and all projects. Mirrors MultiSelectField's
// CopyButton pattern.
export default function AttributeScopeToggle({
  allProjects,
  setAllProjects,
  scopeProjects,
}: {
  allProjects: boolean;
  setAllProjects: (v: boolean) => void;
  // Project ids of the restricted scope, used for the tooltip label.
  scopeProjects?: string[] | null;
}) {
  const { getProjectById } = useDefinitions();

  // The restricted scope is the experiment's project plus its linked
  // features' targeting projects — always name the actual projects.
  const scopeNames = (scopeProjects ?? []).map(
    (id) => getProjectById(id)?.name || id,
  );
  const scopeLabel = allProjects
    ? "All Projects"
    : scopeNames.join(", ") || "the current project scope";
  const scopePrefix = allProjects
    ? ""
    : scopeNames.length > 1
      ? "projects "
      : "project ";

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
        onClick={handleClick}
        onMouseDown={handleMouseDown}
      >
        <PiFunnel />
      </button>
    </Tooltip>
  );
}

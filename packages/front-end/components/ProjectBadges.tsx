import clsx from "clsx";
import { useDefinitions } from "@/services/DefinitionsContext";
import Badge from "@/components/Badge";
import Tooltip from "./Tooltip/Tooltip";

export interface Props {
  projectIds?: string[];
  sort?: boolean;
  className?: string;
}

export default function ProjectBadges({
  projectIds,
  sort = true,
  className = "badge-ellipsis short",
}: Props) {
  const { projects, project } = useDefinitions();
  if (!projectIds) {
    return (
      <Badge
        content="All projects"
        key="All projects"
        className={clsx(
          !project ? "badge-primary bg-purple" : "badge-gray",
          className
        )}
      />
    );
  }

  let filteredProjects = projectIds.map((pid) =>
    projects.find((p) => p.id === pid)
  );
  if (!filteredProjects.length) return null;
  if (sort) {
    filteredProjects = filteredProjects.sort((a, b) => {
      if (!a) return -1;
      if (!b) return 1;
      return (
        new Date(a.dateCreated).getTime() - new Date(b.dateCreated).getTime()
      );
    });
  }

  return (
    <>
      {filteredProjects.map((p) => {
        return (
          <Tooltip
            shouldDisplay={!p?.name ? true : false}
            body="Unknown Projects are projects that have been deleted or projects you do not have access to."
            key={p?.name || `Unknown Project ${p?.id}`}
          >
            <Badge
              content={p?.name || "Unknown Project"}
              className={clsx(
                project === p?.id ? "badge-primary bg-purple" : "badge-gray",
                className
              )}
            />
          </Tooltip>
        );
      })}
    </>
  );
}

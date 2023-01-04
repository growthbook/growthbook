import clsx from "clsx";
import { useDefinitions } from "@/services/DefinitionsContext";
import Badge from "@/components/Badge";

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
    filteredProjects = filteredProjects.sort(
      (a, b) =>
        new Date(a.dateCreated).getTime() - new Date(b.dateCreated).getTime()
    );
  }

  return (
    <>
      {filteredProjects.map((p) => {
        if (!p?.name) return;
        return (
          <Badge
            content={p.name}
            key={p.name}
            className={clsx(
              project === p.id ? "badge-primary bg-purple" : "badge-gray",
              className
            )}
          />
        );
      })}
    </>
  );
}

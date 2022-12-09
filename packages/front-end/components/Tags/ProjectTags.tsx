import { useDefinitions } from "../../services/DefinitionsContext";
import Tag from "./Tag";

export interface Props {
  projectIds?: string[];
  sort?: boolean;
  className?: string;
}

export default function ProjectTags({
  projectIds,
  sort = true,
  className = "badge-ellipsis short",
}: Props) {
  const { projects, project } = useDefinitions();
  if (!projectIds) {
    return (
      <Tag
        tag="All projects"
        key="All projects"
        badgeClassName={!project ? "badge-primary bg-purple" : "badge-gray"}
        className={className}
        skipColor={true}
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
          <Tag
            tag={p.name}
            key={p.name}
            badgeClassName={
              project === p.id ? "badge-primary bg-purple" : "badge-gray"
            }
            className={className}
            skipColor={true}
          />
        );
      })}
    </>
  );
}

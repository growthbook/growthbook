import React, { useState } from "react";
import clsx from "clsx";
import { FaInfoCircle } from "react-icons/fa";
import { useDefinitions } from "@/services/DefinitionsContext";
import Badge from "@/components/Badge";
import Tooltip from "./Tooltip/Tooltip";

export interface Props {
  resourceType: "metric" | "data source" | "member" | "team" | "fact table";
  projectIds?: string[];
  sort?: boolean;
  className?: string;
}

export default function ProjectBadges({
  resourceType,
  projectIds,
  sort = true,
  className = "badge-ellipsis short",
}: Props) {
  const [showMissingProjectError, setShowMissingProjectError] = useState(false);
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
        if (!p && showMissingProjectError !== true) {
          setShowMissingProjectError(true);
        }
        if (!p?.name) return;
        return (
          <Badge
            content={p.name}
            key={p.name}
            className={clsx(
              project === p?.id ? "badge-primary bg-purple" : "badge-gray",
              className
            )}
          />
        );
      })}
      {showMissingProjectError ? (
        <Tooltip
          body={`This ${resourceType} is associated with a project that has been deleted or that you do not have access to.`}
          key="Unknown Project"
          className="pl-2"
        >
          <FaInfoCircle />
        </Tooltip>
      ) : null}
    </>
  );
}

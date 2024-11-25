import { FaExclamationTriangle, FaInfoCircle } from "react-icons/fa";
import React from "react";
import { useDefinitions } from "@/services/DefinitionsContext";
import Tooltip from "./Tooltip/Tooltip";

export interface Props {
  resourceType:
    | "metric"
    | "data source"
    | "environment"
    | "member"
    | "team"
    | "fact table"
    | "attribute"
    | "sdk connection"
    | "saved group";
  projectIds?: string[];
  invalidProjectIds?: string[];
  invalidProjectMessage?: string;
  sort?: boolean;
  className?: string;
  skipMargin?: boolean;
}

export default function ProjectBadges({
  resourceType,
  projectIds,
  invalidProjectIds = [],
  invalidProjectMessage = "This project is invalid",
  sort = true,
}: Props) {
  const { projects } = useDefinitions();
  if (!projectIds) {
    return <>All Projects</>;
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

  const showMissingProjectErr = filteredProjects.some((p) => !p);
  return (
    <>
      {filteredProjects
        .map((p) => {
          if (!p?.name) return;
          return invalidProjectIds.includes(p.id) ? (
            <Tooltip
              popperClassName="text-left"
              popperStyle={{ lineHeight: 1.5 }}
              body={invalidProjectMessage}
            >
              <del className="text-danger">
                <FaExclamationTriangle className="mr-1" />
                {p.name}
              </del>
            </Tooltip>
          ) : (
            p.name
          );
        })
        .join(", ")}
      {showMissingProjectErr ? (
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

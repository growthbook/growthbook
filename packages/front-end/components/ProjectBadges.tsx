import { FaExclamationTriangle, FaInfoCircle } from "react-icons/fa";
import React from "react";
import { useDefinitions } from "@/services/DefinitionsContext";
import Badge from "@/ui/Badge";
import Tooltip from "./Tooltip/Tooltip";

export interface Props {
  resourceType:
    | "metric"
    | "segment"
    | "data source"
    | "environment"
    | "member"
    | "team"
    | "fact table"
    | "feature"
    | "attribute"
    | "sdk connection"
    | "saved group"
    | "holdout"
    | "dashboard"
    | "custom field"
    | "experiment";
  projectIds?: string[];
  invalidProjectIds?: string[];
  invalidProjectMessage?: string;
  sort?: boolean;
  skipMargin?: boolean;
}
// these types can only have one project associated with them, and we don't
// want to show the project badge for them (rather than 'all')
const singularProjectTypes = ["feature", "experiment"];

export default function ProjectBadges({
  resourceType,
  projectIds,
  invalidProjectIds = [],
  invalidProjectMessage = "This project is invalid",
  sort = true,
  skipMargin = false,
}: Props) {
  const { projects, project } = useDefinitions();
  if (!projectIds) {
    if (singularProjectTypes.includes(resourceType)) {
      return null;
    }
    return (
      <Badge
        label="All projects"
        key="All projects"
        color={!project ? "purple" : "gray"}
        style={{
          maxWidth: "120px",
          overflow: "hidden",
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
        }}
      />
    );
  }

  let filteredProjects = projectIds.map((pid) =>
    projects.find((p) => p.id === pid),
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
      {filteredProjects.map((p, i) => {
        if (!p?.name) return;
        return (
          <Badge
            label={
              invalidProjectIds.includes(p.id) ? (
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
              )
            }
            key={p.name}
            color={project === p?.id ? "purple" : "gray"}
            ml={skipMargin || i === 0 ? "0" : "2"}
          />
        );
      })}
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

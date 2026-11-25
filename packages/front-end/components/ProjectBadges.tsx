import { FaExclamationTriangle, FaInfoCircle } from "react-icons/fa";
import React from "react";
import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
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
    | "experiment"
    | "experiment assignment query"
    | "contextual bandit"
    | "interleaving"
    | "constant"
    | "population";
  projectIds?: string[];
  invalidProjectIds?: string[];
  invalidProjectMessage?: string;
  sort?: boolean;
  skipMargin?: boolean;
}
// these types can only have one project associated with them, and we don't
// want to show the project badge for them (rather than 'all')
const singularProjectTypes = [
  "feature",
  "experiment",
  "contextual bandit",
  "interleaving",
  "constant",
];

// One whole message per resource type, so translations needn't splice a noun
// into the sentence.
const missingProjectMessages: Record<Props["resourceType"], MessageDescriptor> =
  {
    metric: msg`This metric is associated with a project that has been deleted or that you do not have access to.`,
    segment: msg`This segment is associated with a project that has been deleted or that you do not have access to.`,
    "data source": msg`This data source is associated with a project that has been deleted or that you do not have access to.`,
    environment: msg`This environment is associated with a project that has been deleted or that you do not have access to.`,
    member: msg`This member is associated with a project that has been deleted or that you do not have access to.`,
    team: msg`This team is associated with a project that has been deleted or that you do not have access to.`,
    "fact table": msg`This fact table is associated with a project that has been deleted or that you do not have access to.`,
    feature: msg`This feature is associated with a project that has been deleted or that you do not have access to.`,
    attribute: msg`This attribute is associated with a project that has been deleted or that you do not have access to.`,
    "sdk connection": msg`This sdk connection is associated with a project that has been deleted or that you do not have access to.`,
    "saved group": msg`This saved group is associated with a project that has been deleted or that you do not have access to.`,
    holdout: msg`This holdout is associated with a project that has been deleted or that you do not have access to.`,
    dashboard: msg`This dashboard is associated with a project that has been deleted or that you do not have access to.`,
    "custom field": msg`This custom field is associated with a project that has been deleted or that you do not have access to.`,
    experiment: msg`This experiment is associated with a project that has been deleted or that you do not have access to.`,
    "experiment assignment query": msg`This experiment assignment query is associated with a project that has been deleted or that you do not have access to.`,
    "contextual bandit": msg`This contextual bandit is associated with a project that has been deleted or that you do not have access to.`,
    interleaving: msg`This interleaving is associated with a project that has been deleted or that you do not have access to.`,
    constant: msg`This constant is associated with a project that has been deleted or that you do not have access to.`,
    population: msg`This population is associated with a project that has been deleted or that you do not have access to.`,
  };

export default function ProjectBadges({
  resourceType,
  projectIds,
  invalidProjectIds = [],
  invalidProjectMessage,
  sort = true,
  skipMargin = false,
}: Props) {
  const { t, i18n } = useLingui();
  const { projects, project } = useDefinitions();
  const invalidProjectText =
    invalidProjectMessage === undefined
      ? t`This project is invalid`
      : invalidProjectMessage;
  if (!projectIds) {
    if (singularProjectTypes.includes(resourceType)) {
      return null;
    }
    return (
      <Badge
        label={t`All Projects`}
        key="All Projects"
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
                  body={invalidProjectText}
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
          body={i18n._(missingProjectMessages[resourceType])}
          key="Unknown Project"
          className="pl-2"
        >
          <FaInfoCircle />
        </Tooltip>
      ) : null}
    </>
  );
}

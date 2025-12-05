import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { Flex, Text } from "@radix-ui/themes";
import { date } from "shared/dates";
import { PiWarning } from "react-icons/pi";
import React from "react";
import { HoldoutInterface } from "back-end/src/validators/holdout";
import SortedTags from "@/components/Tags/SortedTags";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import UserAvatar from "@/components/Avatar/UserAvatar";
import Metadata from "@/ui/Metadata";
import metaDataStyles from "@/ui/Metadata.module.scss";
import Link from "@/ui/Link";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useHoldouts } from "@/hooks/useHoldouts";
import ProjectBadges from "@/components/ProjectBadges";
import { FocusSelector } from "./EditExperimentInfoModal";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  holdout?: HoldoutInterface;
  setShowEditInfoModal: (value: boolean) => void;
  setEditInfoFocusSelector: (value: FocusSelector) => void;
  editTags?: (() => void) | null;
}

export default function ProjectTagBar({
  experiment,
  holdout,
  setShowEditInfoModal,
  setEditInfoFocusSelector,
  editTags,
}: Props) {
  const {
    projects,
    project: currentProject,
    getProjectById,
  } = useDefinitions();

  const { getUserDisplay } = useUser();
  const projectId = experiment.project;
  const project = getProjectById(experiment.project || "");
  const projectName = project?.name || null;
  const projectIsDeReferenced = projectId && !projectName;

  const { holdoutsMap } = useHoldouts();

  const permissionsUtil = usePermissionsUtil();
  const canUpdateExperimentProject = (project) =>
    permissionsUtil.canUpdateExperiment({ project }, {});

  const canUpdateHoldoutProjects = (projects) =>
    permissionsUtil.canUpdateHoldout({ projects }, { projects: [] });

  const trackingKey = experiment.trackingKey;

  const createdDate = date(experiment.dateCreated);

  const ownerName = getUserDisplay(experiment.owner, false) || "";

  const renderOwner = () => {
    return (
      <>
        <span>
          {ownerName !== "" && (
            <UserAvatar name={ownerName} size="sm" variant="soft" />
          )}
          <Text weight="regular" className={metaDataStyles.valueColor} ml="1">
            {ownerName === "" ? "None" : ownerName}
          </Text>
        </span>
      </>
    );
  };

  const RenderToolTipsAndValue = () => {
    if (projectIsDeReferenced) {
      return (
        <Tooltip
          body={
            <>
              Project <code>{projectId}</code> not found
            </>
          }
        >
          <span className="text-danger">
            <PiWarning /> Invalid project
          </span>
        </Tooltip>
      );
    } else if (currentProject && currentProject !== experiment.project) {
      return (
        <Tooltip body={<>This experiment is not in your current project.</>}>
          {projectId && <strong>{projectName}</strong>}{" "}
          <PiWarning className="text-warning" />
        </Tooltip>
      );
    } else {
      return (
        projectId && (
          <Text weight="regular" className={metaDataStyles.valueColor}>
            {projectName}
          </Text>
        )
      );
    }
  };
  const renderProjectMetaDataValue = () => {
    return (
      <Flex gap="1">
        {RenderToolTipsAndValue()}
        {canUpdateExperimentProject(project) && !projectId && (
          <Link
            onClick={(e) => {
              e.preventDefault();
              setEditInfoFocusSelector("project");
              setShowEditInfoModal(true);
            }}
          >
            +Add
          </Link>
        )}
        {!canUpdateExperimentProject(project) && !projectId && "None"}
      </Flex>
    );
  };

  const renderHoldoutProjectMetaDataValue = () => {
    if (!holdout) {
      return null;
    }

    return (
      <Flex gap="1">
        {holdout.projects.length > 0 && (
          <ProjectBadges resourceType="holdout" projectIds={holdout.projects} />
        )}
        {canUpdateHoldoutProjects(holdout.projects) &&
          holdout.projects.length === 0 && (
            <Link
              onClick={(e) => {
                e.preventDefault();
                setEditInfoFocusSelector("projects");
                setShowEditInfoModal(true);
              }}
            >
              +Add
            </Link>
          )}
        {!canUpdateHoldoutProjects(holdout.projects) &&
          holdout.projects.length === 0 && (
            <Text weight="regular" className={metaDataStyles.valueColor}>
              None
            </Text>
          )}
      </Flex>
    );
  };

  const renderProject = () => {
    return (projects.length > 0 || projectIsDeReferenced) && !holdout ? (
      <Metadata label="Project" value={renderProjectMetaDataValue()} />
    ) : holdout ? (
      <Metadata label="Projects" value={renderHoldoutProjectMetaDataValue()} />
    ) : null;
  };
  const renderTagsValue = () => {
    return (
      <Flex gap="1">
        {experiment.tags?.length > 0 && (
          <SortedTags
            tags={experiment.tags}
            useFlex
            shouldShowEllipsis={false}
          />
        )}
        {editTags && experiment.tags?.length === 0 && (
          <Link
            onClick={(e) => {
              e.preventDefault();
              setEditInfoFocusSelector("tags");
              setShowEditInfoModal(true);
            }}
          >
            +Add
          </Link>
        )}
      </Flex>
    );
  };
  return (
    <div className="pb-3">
      <Flex gap="3" mt="2" mb="1" wrap="wrap">
        {experiment.holdoutId && (
          <Metadata
            label="Holdout"
            value={
              <Link href={`/holdout/${experiment.holdoutId}`}>
                {holdoutsMap.get(experiment.holdoutId)?.name}
              </Link>
            }
          />
        )}
        {renderProject()}
        {experiment.type !== "holdout" && (
          <Metadata label="Experiment Key" value={trackingKey || "None"} />
        )}
        <Metadata label="Created" value={createdDate} />
        <Metadata label="Owner" value={renderOwner()} />
      </Flex>
      <div className="row">
        <div className="col-auto">
          <Metadata label="Tags" value={renderTagsValue()} />
        </div>
      </div>
    </div>
  );
}

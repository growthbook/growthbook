import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { Flex, Text } from "@radix-ui/themes";
import { date } from "shared/dates";
import { PiWarning } from "react-icons/pi";
import React, { useState } from "react";
import { GBEdit } from "@/components/Icons";
import SortedTags from "@/components/Tags/SortedTags";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import UserAvatar from "@/components/Avatar/UserAvatar";
import Metadata from "@/components/Radix/Metadata";
import metaDataStyles from "@/components/Radix/Styles/Metadata.module.scss";
import Link from "@/components/Radix/Link";
import EditOwnerModal from "@/components/Owner/EditOwnerModal";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  editTags?: (() => void) | null;
  editProject?: (() => void) | null;
  canEditOwner?: boolean;
  updateOwner?: (owner: string) => Promise<void>;
  mutate?: () => void;
}

export default function ProjectTagBar({
  experiment,
  editProject,
  editTags,
  canEditOwner,
  updateOwner,
  mutate,
}: Props) {
  const {
    projects,
    project: currentProject,
    getProjectById,
  } = useDefinitions();

  const { getUserDisplay } = useUser();

  const [editOwnerModal, setEditOwnerModal] = useState(false);
  const projectId = experiment.project;
  const project = getProjectById(experiment.project || "");
  const projectName = project?.name || null;
  const projectIsDeReferenced = projectId && !projectName;

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
          {canEditOwner && updateOwner && (
            <a
              className="ml-1 cursor-pointer link-purple"
              onClick={() => setEditOwnerModal(true)}
            >
              <GBEdit />
            </a>
          )}
        </span>
        {editOwnerModal && (
          <EditOwnerModal
            cancel={() => setEditOwnerModal(false)}
            owner={ownerName}
            save={
              updateOwner ??
              (async (ownerName) => {
                throw new Error(
                  "save method not defined. Not updated to: " + ownerName
                );
              })
            }
            mutate={mutate ?? (() => {})}
          />
        )}
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
        {editProject && !projectId && (
          <Link
            onClick={(e) => {
              e.preventDefault();
              editProject();
            }}
          >
            +Add
          </Link>
        )}
        {editProject && projectId && (
          <Link
            onClick={(e) => {
              e.preventDefault();
              editProject();
            }}
          >
            <GBEdit />
          </Link>
        )}
      </Flex>
    );
  };
  const renderProject = () => {
    return projects.length > 0 || projectIsDeReferenced ? (
      <Metadata label="Project" value={renderProjectMetaDataValue()} />
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
              editTags();
            }}
          >
            +Add
          </Link>
        )}
        {editTags && experiment.tags?.length > 0 && (
          <Link
            onClick={(e) => {
              e.preventDefault();
              editTags();
            }}
          >
            <GBEdit />
          </Link>
        )}
      </Flex>
    );
  };
  return (
    <div className="pb-3">
      <Flex gap="3" mt="2" mb="1">
        {renderProject()}
        <Metadata label="Experiment Key" value={trackingKey || "None"} />
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

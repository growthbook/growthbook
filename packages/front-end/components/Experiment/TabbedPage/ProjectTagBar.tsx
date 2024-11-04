import { FaExclamationTriangle } from "react-icons/fa";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { Text } from "@radix-ui/themes";
import { date } from "shared/dates";
import { GBEdit } from "@/components/Icons";
import SortedTags from "@/components/Tags/SortedTags";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import UserAvatar from "@/components/Avatar/UserAvatar";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  editTags?: (() => void) | null;
  editProject?: (() => void) | null;
}

export default function ProjectTagBar({
  experiment,
  editProject,
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

  const trackingKey = experiment.trackingKey;

  const createdDate = date(experiment.dateCreated);

  const ownerName = getUserDisplay(experiment.owner, false) || "";

  return (
    <div className="pb-3">
      <div className="experiment-top-rows row align-items-baseline mt-2 mb-2">
        {projects.length > 0 || projectIsDeReferenced ? (
          <div className="col-auto">
            <Text weight="medium">Project: </Text>
            {projectIsDeReferenced ? (
              <Tooltip
                body={
                  <>
                    Project <code>{projectId}</code> not found
                  </>
                }
              >
                <span className="text-danger">
                  <FaExclamationTriangle /> Invalid project
                </span>
              </Tooltip>
            ) : currentProject && currentProject !== experiment.project ? (
              <Tooltip
                body={<>This experiment is not in your current project.</>}
              >
                {projectId && <strong>{projectName}</strong>}{" "}
                <FaExclamationTriangle className="text-warning" />
              </Tooltip>
            ) : (
              projectId && <strong>{projectName}</strong>
            )}
            {editProject && !projectId && (
              <a
                role="button"
                className="cursor-pointer button-link"
                onClick={(e) => {
                  e.preventDefault();
                  editProject();
                }}
              >
                +Add
              </a>
            )}
            {editProject && projectId && (
              <a
                role="button"
                className="ml-2 cursor-pointer"
                onClick={(e) => {
                  e.preventDefault();
                  editProject();
                }}
              >
                <GBEdit />
              </a>
            )}
          </div>
        ) : null}
        <div className="col-auto">
          <Text weight="medium">Experiment Key: </Text>
          {trackingKey ? (
            <span>{trackingKey}</span>
          ) : (
            <em className="text-muted">None</em>
          )}{" "}
        </div>
        <div className="col-auto">
          <Text weight="medium">Created: </Text>
          <span>{createdDate}</span>{" "}
        </div>
        <div className="col-auto">
          <Text weight="medium">Owner: </Text>
          {ownerName ? (
            <span>
              <UserAvatar name={ownerName} size="sm" variant="soft" />{" "}
              {ownerName}
            </span>
          ) : (
            <em className="text-muted">None</em>
          )}{" "}
        </div>
      </div>
      <div className="row">
        <div className="col-auto">
          <Text weight="medium">Tags: </Text>
          {experiment.tags?.length > 0 && (
            <SortedTags
              tags={experiment.tags}
              useFlex
              shouldShowEllipsis={false}
            />
          )}{" "}
          {editTags && experiment.tags?.length === 0 && (
            <a
              role="button"
              className="cursor-pointer button-link"
              onClick={(e) => {
                e.preventDefault();
                editTags();
              }}
            >
              +Add
            </a>
          )}
          {editTags && experiment.tags?.length > 0 && (
            <a
              role="button"
              className="ml-1 cursor-pointer"
              onClick={(e) => {
                e.preventDefault();
                editTags();
              }}
            >
              <GBEdit />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

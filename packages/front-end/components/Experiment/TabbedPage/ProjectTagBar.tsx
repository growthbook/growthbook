import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { Flex, Link, Text } from "@radix-ui/themes";
import { date } from "shared/dates";
import { PiWarning } from "react-icons/pi";
import { GBEdit } from "@/components/Icons";
import SortedTags from "@/components/Tags/SortedTags";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";
import UserAvatar from "@/components/Avatar/UserAvatar";
import Metadata from "@/components/Radix/Metadata";
import metaDataStyles from "@/components/Radix/Styles/Metadata.module.scss";

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

  const renderOwner = () => {
    if (ownerName === "") {
      return "None";
    }
    return (
      <span>
        <UserAvatar name={ownerName} size="sm" variant="soft" />{" "}
        <Text weight="regular" className={metaDataStyles.valueColor}>
          {ownerName}
        </Text>
      </span>
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

  return (
    <div className="pb-3">
      <Flex gap="3" mt="2" mb="1">
        {renderProject()}
        <Metadata label="Experiment Key" value={trackingKey || "None"} />
        <Metadata label="Created" value={createdDate} />
        <Metadata label="Owner" value={ownerName || "None"} />
        <Metadata label="Owner" value={renderOwner()} />
      </Flex>
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
              role="button"
              className="ml-1 cursor-pointer"
              onClick={(e) => {
                e.preventDefault();
                editTags();
              }}
            >
              <GBEdit />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

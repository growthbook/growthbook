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
              未找到项目 <code>{projectId}</code>
            </>
          }
        >
          <span className="text-danger">
            <PiWarning /> 无效项目
          </span>
        </Tooltip>
      );
    } else if (currentProject && currentProject !== experiment.project) {
      return (
        <Tooltip body={<>此实验不在当前项目中。</>}>
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
            className="cursor-pointer"
            onClick={(e) => {
              e.preventDefault();
              editProject();
            }}
          >
            <span className="cursor-pointer">+添加</span>
          </Link>
        )}
        {editProject && projectId && (
          <Link
            className="cursor-pointer"
            onClick={(e) => {
              e.preventDefault();
              editProject();
            }}
          >
            <GBEdit className="cursor-pointer" />
          </Link>
        )}
      </Flex>
    );
  };
  const renderProject = () => {
    return projects.length > 0 || projectIsDeReferenced ? (
      <Metadata label="项目" value={renderProjectMetaDataValue()} />
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
            className="cursor-pointer"
            onClick={(e) => {
              e.preventDefault();
              editTags();
            }}
          >
            <span className="cursor-pointer">+添加</span>
          </Link>
        )}
        {editTags && experiment.tags?.length > 0 && (
          <Link
            className="cursor-pointer"
            onClick={(e) => {
              e.preventDefault();
              editTags();
            }}
          >
            <GBEdit className="cursor-pointer" />
          </Link>
        )}
      </Flex>
    );
  };
  return (
    <div className="pb-3">
      <Flex gap="3" mt="2" mb="1">
        {renderProject()}
        <Metadata label="实验Key" value={trackingKey || "None"} />
        <Metadata label="创建时间" value={createdDate} />
        <Metadata label="所有者" value={renderOwner()} />
      </Flex>
      <div className="row">
        <div className="col-auto">
          <Metadata label="标签" value={renderTagsValue()} />
        </div>
      </div>
    </div>
  );
}

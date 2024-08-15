import { FaExclamationTriangle, FaExternalLinkAlt } from "react-icons/fa";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { IdeaInterface } from "back-end/types/idea";
import Link from "next/link";
import { GBEdit } from "@front-end/components/Icons";
import SortedTags from "@front-end/components/Tags/SortedTags";
import Tooltip from "@front-end/components/Tooltip/Tooltip";
import { useDefinitions } from "@front-end/services/DefinitionsContext";
import { useUser } from "@front-end/services/UserContext";

export interface Props {
  experiment: ExperimentInterfaceStringDates;
  editTags?: (() => void) | null;
  editProject?: (() => void) | null;
  idea?: IdeaInterface;
}

export default function ProjectTagBar({
  experiment,
  editProject,
  editTags,
  idea,
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

  const ownerName = getUserDisplay(experiment.owner, false) || "";

  return (
    <div className="experiment-top-rows row align-items-center mb-3">
      {projects.length > 0 || projectIsDeReferenced ? (
        <div className="col-auto">
          Project:{" "}
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
              {projectId ? (
                <strong>{projectName}</strong>
              ) : (
                <em className="text-muted">None</em>
              )}{" "}
              <FaExclamationTriangle className="text-warning" />
            </Tooltip>
          ) : projectId ? (
            <strong>{projectName}</strong>
          ) : (
            <em className="text-muted">None</em>
          )}
          {editProject && (
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
        Tags:{" "}
        {experiment.tags?.length > 0 ? (
          <SortedTags tags={experiment.tags} skipFirstMargin={true} />
        ) : (
          <em className="text-muted">None</em>
        )}{" "}
        {editTags && (
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
      <div className="col-auto">
        Owner:{" "}
        {ownerName ? (
          <strong>{ownerName}</strong>
        ) : (
          <em className="text-muted">None</em>
        )}{" "}
      </div>

      {idea && (
        <div className="col-auto">
          Idea:{" "}
          <Link
            href={`/idea/${idea.id}`}
            style={{
              maxWidth: 160,
              overflow: "hidden",
              textOverflow: "ellipsis",
              display: "inline-block",
              whiteSpace: "nowrap",
              verticalAlign: "middle",
            }}
            title={idea.text}
          >
            <FaExternalLinkAlt /> {idea.text}
          </Link>
        </div>
      )}
    </div>
  );
}

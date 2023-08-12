import { FaExclamationTriangle } from "react-icons/fa";
import { ExperimentInterfaceStringDates } from "back-end/types/experiment";
import { GBEdit } from "@/components/Icons";
import SortedTags from "@/components/Tags/SortedTags";
import Tooltip from "@/components/Tooltip/Tooltip";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useUser } from "@/services/UserContext";

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
      <div className="col-auto pr-3 ml-2">
        Tags:{" "}
        {experiment.tags?.length > 0 ? (
          <span className="d-inline-block" style={{ maxWidth: 250 }}>
            <SortedTags tags={experiment.tags} skipFirstMargin={true} />
          </span>
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
      <div className="col-auto pr-3 ml-2 mr-4">
        Owner:{" "}
        {ownerName ? (
          <strong>{ownerName}</strong>
        ) : (
          <em className="text-muted">None</em>
        )}{" "}
      </div>
    </div>
  );
}

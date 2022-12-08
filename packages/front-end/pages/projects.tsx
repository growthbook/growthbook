import { useState, FC } from "react";
import { FaFolderPlus, FaPencilAlt } from "react-icons/fa";
import { ProjectInterface } from "back-end/types/project";
import DeleteButton from "../components/DeleteButton/DeleteButton";
import ProjectModal from "../components/Projects/ProjectModal";
import { useAuth } from "../services/auth";
import { date } from "../services/dates";
import { useDefinitions } from "../services/DefinitionsContext";
import usePermissions from "../hooks/usePermissions";

const ProjectsPage: FC = () => {
  const permissions = usePermissions();

  const {
    projects,
    mutateDefinitions,
    datasources,
    metrics,
  } = useDefinitions();

  console.log(datasources);

  const { apiCall } = useAuth();
  const [modalOpen, setModalOpen] = useState<Partial<ProjectInterface> | null>(
    null
  );

  if (!permissions.manageProjects) {
    return (
      <div className="container pagecontents">
        <div className="alert alert-danger">
          You do not have access to view this page.
        </div>
      </div>
    );
  }

  return (
    <div className="container-fluid  pagecontents">
      {modalOpen && (
        <ProjectModal
          existing={modalOpen}
          close={() => setModalOpen(null)}
          onSuccess={() => mutateDefinitions()}
        />
      )}
      <h1>Projects</h1>
      <p>
        Group your ideas and experiments into <strong>Projects</strong> to keep
        things organized and easy to manage.
      </p>
      {projects.length > 0 ? (
        <table className="table appbox gbtable table-hover">
          <thead>
            <tr>
              <th>Project Name</th>
              <th>Project Id</th>
              <th>Date Created</th>
              <th>Date Updated</th>
              <th>Data Sources</th>
              <th>Metrics</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{p.id}</td>
                <td>{date(p.dateCreated)}</td>
                <td>{date(p.dateUpdated)}</td>
                <td className="col-2">
                  {p.datasources.map((ds) => (
                    <span
                      key={`datasource_tag_${ds}`}
                      className="tag mr-2 badge badge-primary"
                    >
                      {datasources.find((d) => d.id === ds)?.name}
                    </span>
                  ))}
                </td>
                <td className="col-2">
                  {p.metrics.map((m) => (
                    <span
                      key={`metric_tag_${m}`}
                      className="tag mr-2 badge badge-primary"
                    >
                      {metrics.find((mm) => mm.id === m)?.name}
                    </span>
                  ))}
                </td>
                <td>
                  <button
                    className="btn btn-outline-primary"
                    onClick={(e) => {
                      e.preventDefault();
                      setModalOpen(p);
                    }}
                  >
                    <FaPencilAlt />
                  </button>{" "}
                  <DeleteButton
                    displayName="project"
                    onClick={async () => {
                      await apiCall(`/projects/${p.id}`, {
                        method: "DELETE",
                      });
                      mutateDefinitions();
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>Click the button below to create your first project!</p>
      )}
      <button
        className="btn btn-primary"
        onClick={(e) => {
          e.preventDefault();
          setModalOpen({});
        }}
      >
        <FaFolderPlus /> Create Project
      </button>
    </div>
  );
};
export default ProjectsPage;

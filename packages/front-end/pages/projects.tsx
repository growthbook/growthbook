import { useState, FC } from "react";
import { FaFolderPlus, FaPencilAlt } from "react-icons/fa";
import { ProjectInterface } from "back-end/types/project";
import DeleteButton from "../components/DeleteButton";
import ProjectModal from "../components/Projects/ProjectModal";
import { useAuth } from "../services/auth";
import { date } from "../services/dates";
import { useDefinitions } from "../services/DefinitionsContext";

const ProjectsPage: FC = () => {
  const { projects, mutateDefinitions } = useDefinitions();

  const { apiCall } = useAuth();
  const [modalOpen, setModalOpen] = useState<Partial<ProjectInterface> | null>(
    null
  );

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
              <th>Project Id</th>
              <th>Project Name</th>
              <th>Date Created</th>
              <th>Date Updated</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id}>
                <td>{p.id}</td>
                <td>{p.name}</td>
                <td>{date(p.dateCreated)}</td>
                <td>{date(p.dateUpdated)}</td>
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

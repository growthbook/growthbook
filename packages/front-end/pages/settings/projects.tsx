import Link from "next/link";
import { useState } from "react";
import { FC } from "react";
import { FaAngleLeft, FaFolderPlus, FaPencilAlt } from "react-icons/fa";
import { ProjectInterface } from "back-end/types/project";
import DeleteButton from "../../components/DeleteButton";
import ProjectModal from "../../components/Projects/ProjectModal";
import { useAuth } from "../../services/auth";
import { date } from "../../services/dates";
import { useDefinitions } from "../../services/DefinitionsContext";

const ProjectsPage: FC = () => {
  const { projects, mutateDefinitions } = useDefinitions();

  const { apiCall } = useAuth();
  const [modalOpen, setModalOpen] = useState<Partial<ProjectInterface> | null>(
    null
  );

  return (
    <div className="container-fluid mt-3 pagecontents">
      {modalOpen && (
        <ProjectModal
          existing={modalOpen}
          close={() => setModalOpen(null)}
          onSuccess={() => mutateDefinitions()}
        />
      )}
      <div className="mb-2">
        <Link href="/settings">
          <a>
            <FaAngleLeft /> All Settings
          </a>
        </Link>
      </div>
      <h1>Projects</h1>
      <p>
        Group your ideas and experiments into <strong>Projects</strong> to keep
        things organized and easy to manage.
      </p>
      {projects.length > 0 && (
        <table className="table appbox table-hover">
          <thead>
            <tr>
              <th>Project Name</th>
              <th>Date Created</th>
              <th>Date Updated</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id}>
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
      )}
      <p>Click the green button below to create your first project!</p>
      <button
        className="btn btn-success"
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

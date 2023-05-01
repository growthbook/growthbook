import { useState, FC } from "react";
import {
  FaExclamationTriangle,
  FaFolderPlus,
  FaPencilAlt,
} from "react-icons/fa";
import { ProjectInterface } from "back-end/types/project";
import { date } from "shared";
import usePermissions from "@/hooks/usePermissions";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import ProjectModal from "@/components/Projects/ProjectModal";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import useSDKConnections from "@/hooks/useSDKConnections";

const ProjectsPage: FC = () => {
  const permissions = usePermissions();
  const { projects, mutateDefinitions } = useDefinitions();
  const { apiCall } = useAuth();

  const [modalOpen, setModalOpen] = useState<Partial<ProjectInterface> | null>(
    null
  );

  const { data: sdkConnectionsData } = useSDKConnections();

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
                    additionalMessage={
                      sdkConnectionsData?.connections?.find(
                        (c) => c.project === p.id
                      ) ? (
                        <div className="alert alert-danger px-2 py-1">
                          <FaExclamationTriangle /> This project is in use by
                          one or more SDK Connections. Deleting it will cause
                          those connections to stop working.
                        </div>
                      ) : null
                    }
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

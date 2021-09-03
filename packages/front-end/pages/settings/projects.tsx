import Link from "next/link";
import { useState } from "react";
import { FC } from "react";
import { FaAngleLeft, FaFolderPlus, FaPencilAlt } from "react-icons/fa";
import DeleteButton from "../../components/DeleteButton";
import EditProjectModal from "../../components/Projects/EditProjectModal";
import NewProjectModal from "../../components/Projects/NewProjectModal";
import { useAuth } from "../../services/auth";
import { useDefinitions } from "../../services/DefinitionsContext";
import { hasFileConfig } from "../../services/env";

const ProjectsPage: FC = () => {
  const { projects, mutateDefinitions, metrics, dimensions } = useDefinitions();

  const numMetrics: Record<string, number> = {};
  const numDimensions: Record<string, number> = {};

  const { apiCall } = useAuth();
  const [editOpen, setEditOpen] = useState("");
  const [addOpen, setAddOpen] = useState(false);

  metrics.forEach((m) => {
    if (m.projects?.length) {
      m.projects.forEach((p) => {
        numMetrics[p] = numMetrics[p] || 0;
        numMetrics[p]++;
      });
    }
  });
  dimensions.forEach((d) => {
    if (d.projects?.length) {
      d.projects.forEach((p) => {
        numDimensions[p] = numDimensions[p] || 0;
        numDimensions[p]++;
      });
    }
  });

  return (
    <div className="container-fluid mt-3 pagecontents">
      {addOpen && (
        <NewProjectModal
          close={() => setAddOpen(false)}
          onSuccess={() => mutateDefinitions()}
        />
      )}
      {editOpen && (
        <EditProjectModal
          close={() => setEditOpen("")}
          onSuccess={() => mutateDefinitions()}
          project={projects.filter((p) => p.id === editOpen)[0]}
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
        Group your experiments, metrics, dimensions, and more into{" "}
        <strong>Projects</strong> to keep things organized and easy to manage.
      </p>
      {projects.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Project Name</th>
              <th>Metrics</th>
              <th>Dimensions</th>
              {!hasFileConfig() && <th></th>}
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{numMetrics[p.id] || 0}</td>
                <td>{numDimensions[p.id] || 0}</td>
                {!hasFileConfig() && (
                  <td>
                    <button
                      className="btn btn-outline-primary"
                      onClick={(e) => {
                        e.preventDefault();
                        setEditOpen(p.id);
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
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!hasFileConfig() && projects.length === 0 && (
        <p>Click the green button below to create your first project!</p>
      )}
      {hasFileConfig() ? (
        <div className="alert alert-info">
          You are using <strong>config.yml</strong> to manage settings. Add,
          edit, or remove projects there.{" "}
          <a
            href="https://docs.growthbook.io/self-host/config#configyml"
            target="_blank"
            rel="noreferrer"
          >
            View Documentation
          </a>
        </div>
      ) : (
        <button
          className="btn btn-success"
          onClick={(e) => {
            e.preventDefault();
            setAddOpen(true);
          }}
        >
          <FaFolderPlus /> Create Project
        </button>
      )}
    </div>
  );
};
export default ProjectsPage;

import { useState, FC } from "react";
import useApi from "../hooks/useApi";
import { GBAddCircle } from "../components/Icons";
import LoadingOverlay from "../components/LoadingOverlay";
import NamespaceModal from "../components/Experiment/NamespaceModal";
import { Namespaces, NamespaceUsage } from "back-end/types/organization";
import useOrgSettings from "../hooks/useOrgSettings";
import useUser from "../hooks/useUser";
import NamespaceTableRow from "../components/Settings/NamespaceTableRow";
import { useAuth } from "../services/auth";
import usePermissions from "../hooks/usePermissions";

export type NamespaceApiResponse = {
  namespaces: NamespaceUsage;
};

const NamespacesPage: FC = () => {
  const { data, error } = useApi<NamespaceApiResponse>(
    `/organization/namespaces`
  );

  const permissions = usePermissions();
  const canEdit = permissions.manageNamespaces;

  const { update } = useUser();
  const { namespaces } = useOrgSettings();
  const [modalOpen, setModalOpen] = useState(false);
  const [editNamespace, setEditNamespace] = useState<{
    namespace: Namespaces;
    experiments: number;
  } | null>(null);
  const { apiCall } = useAuth();

  if (error) {
    return (
      <div className="alert alert-danger">
        An error occurred: {error.message}
      </div>
    );
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  return (
    <div className="container-fluid pagecontents">
      {modalOpen && (
        <NamespaceModal
          existing={editNamespace}
          close={() => {
            setModalOpen(false);
            setEditNamespace(null);
          }}
          onSuccess={() => {
            update();
            setEditNamespace(null);
          }}
        />
      )}
      <h1>Experiment Namespaces</h1>
      <p>
        Namespaces allow you to run mutually exclusive experiments.{" "}
        {namespaces?.length > 0 &&
          "Click a namespace below to see more details about it's current usage."}
      </p>
      {namespaces?.length > 0 && (
        <table className="table appbox gbtable table-hover">
          <thead>
            <tr>
              <th>Namespace</th>
              <th>Description</th>
              <th>Active experiments</th>
              <th>Percent available</th>
              {canEdit && <th style={{ width: 30 }}></th>}
            </tr>
          </thead>
          <tbody>
            {namespaces.map((ns, i) => {
              const experiments = data?.namespaces[ns.name] ?? [];
              return (
                <NamespaceTableRow
                  i={i}
                  key={ns.name}
                  usage={data.namespaces}
                  namespace={ns}
                  onEdit={() => {
                    setEditNamespace({
                      namespace: ns,
                      experiments: experiments.length,
                    });
                    setModalOpen(true);
                  }}
                  onDelete={async () => {
                    await apiCall(`/organization/namespaces/${ns.name}`, {
                      method: "DELETE",
                    });
                    await update();
                  }}
                  onArchive={async () => {
                    const newNamespace = {
                      name: ns.name,
                      description: ns.description,
                      status: ns?.status === "inactive" ? "active" : "inactive",
                    };
                    await apiCall(`/organization/namespaces/${ns.name}`, {
                      method: "PUT",
                      body: JSON.stringify(newNamespace),
                    });
                    await update();
                  }}
                />
              );
            })}
          </tbody>
        </table>
      )}
      {canEdit && (
        <button
          className="btn btn-primary"
          onClick={(e) => {
            e.preventDefault();
            setModalOpen(true);
          }}
        >
          <GBAddCircle /> Create Namespace
        </button>
      )}
    </div>
  );
};
export default NamespacesPage;

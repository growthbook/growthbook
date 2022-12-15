import { useState, FC } from "react";
import { Namespaces, NamespaceUsage } from "back-end/types/organization";
import useApi from "../hooks/useApi";
import { GBAddCircle } from "../components/Icons";
import LoadingOverlay from "../components/LoadingOverlay";
import NamespaceModal from "../components/Experiment/NamespaceModal";
import useOrgSettings from "../hooks/useOrgSettings";
import { useUser } from "../services/UserContext";
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

  const { refreshOrganization } = useUser();
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
            refreshOrganization();
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
                    await refreshOrganization();
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
                    await refreshOrganization();
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

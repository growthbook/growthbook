import { useState } from "react";
import { FC } from "react";
import useApi from "../hooks/useApi";
import { GBAddCircle } from "../components/Icons";
import LoadingOverlay from "../components/LoadingOverlay";
import NamespaceModal from "../components/Experiment/NamespaceModal";
import { NamespaceUsage } from "back-end/types/organization";
import useOrgSettings from "../hooks/useOrgSettings";
import useUser from "../hooks/useUser";
import NamespaceTableRow from "../components/Settings/NamespaceTableRow";
import { useAuth } from "../services/auth";

export type NamespaceApiResponse = {
  namespaces: NamespaceUsage;
};

const NamespacesPage: FC = () => {
  const { data, error } = useApi<NamespaceApiResponse>(
    `/organization/namespaces`
  );

  const { update } = useUser();
  const { namespaces } = useOrgSettings();
  const [modalOpen, setModalOpen] = useState(false);
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
          close={() => setModalOpen(false)}
          onSuccess={() => {
            update();
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
              <th></th>
            </tr>
          </thead>
          <tbody>
            {namespaces.map((ns) => {
              return (
                <NamespaceTableRow
                  key={ns.name}
                  usage={data.namespaces}
                  namespace={ns}
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
                    await apiCall(`/organization/namespaces`, {
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
      <button
        className="btn btn-primary"
        onClick={(e) => {
          e.preventDefault();
          setModalOpen(true);
        }}
      >
        <GBAddCircle /> Create Namespace
      </button>
    </div>
  );
};
export default NamespacesPage;

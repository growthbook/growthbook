import { FC, useState } from "react";
import { OrganizationInterface } from "back-end/types/organization";
import clsx from "clsx";
import { FaPlus } from "react-icons/fa";
import useApi from "../hooks/useApi";
import LoadingOverlay from "../components/LoadingOverlay";
import { useAuth } from "../services/auth";
import CreateOrganization from "../components/CreateOrganization";
import Button from "../components/Button";

const Admin: FC = () => {
  const { data, error, mutate } = useApi<{
    organizations: (OrganizationInterface & { canPopulate: boolean })[];
  }>("/admin/organizations");
  const [orgModalOpen, setOrgModalOpen] = useState(false);
  const { orgId, setOrgId, setSpecialOrg, apiCall } = useAuth();

  if (error) {
    return <div className="alert alert-danger">{error.message}</div>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  return (
    <div className="container-fluid p-3 pagecontents">
      {orgModalOpen && (
        <CreateOrganization
          isAdmin={true}
          onCreate={() => {
            mutate();
          }}
          close={() => setOrgModalOpen(false)}
        />
      )}
      <button
        className="btn btn-primary float-right"
        onClick={(e) => {
          e.preventDefault();
          setOrgModalOpen(true);
        }}
      >
        <FaPlus /> New Organization
      </button>
      <h1>GrowthBook Admin</h1>
      <p>Click an organization below to switch to it.</p>
      <table className="table appbox">
        <thead>
          <tr>
            <th>Name</th>
            <th>Owner</th>
            <th>Id</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {data.organizations.map((o) => (
            <tr
              key={o.id}
              className={clsx({
                "table-warning": orgId === o.id,
              })}
            >
              <td>
                <a
                  className={clsx("mb-1 h5")}
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setOrgId(o.id);
                    setSpecialOrg(o);
                  }}
                >
                  {o.name}
                </a>
              </td>
              <td>{o.ownerEmail}</td>
              <td>
                <small>{o.id}</small>
              </td>
              <td>
                {o.canPopulate && (
                  <Button
                    color="outline-secondary"
                    onClick={async () => {
                      await apiCall(`/admin/organization/${o.id}/populate`, {
                        method: "POST",
                      });
                      mutate();
                    }}
                  >
                    Populate with Sample Data
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default Admin;

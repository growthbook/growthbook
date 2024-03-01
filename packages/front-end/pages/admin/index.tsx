import { FC, useCallback, useEffect, useState } from "react";
import { OrganizationInterface } from "back-end/types/organization";
import { FaPlus, FaSearch } from "react-icons/fa";
import Field from "@/components/Forms/Field";
import Pagination from "@/components/Pagination";
import { useUser } from "@/services/UserContext";
import OrphanedUsersList from "@/components/Settings/Team/OrphanedUsersList";
import { isCloud, isMultiOrg } from "@/services/env";
import LoadingOverlay from "@/components/LoadingOverlay";
import CreateOrganization from "@/components/Admin/CreateOrganization";
import ShowLicenseInfo from "@/components/License/ShowLicenseInfo";
import { useAuth } from "@/services/auth";
import OrganizationRow from "./OrganizationRow";

const numberFormatter = new Intl.NumberFormat();

const Admin: FC = () => {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");

  const { orgId, setOrgId, setSpecialOrg, apiCall } = useAuth();

  const { superAdmin } = useUser();

  const [orgs, setOrgs] = useState<OrganizationInterface[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const loadOrgs = useCallback(
    async (page: number, search: string) => {
      setLoading(true);
      const params = new URLSearchParams();

      params.append("page", page + "");
      params.append("search", search);

      try {
        const res = await apiCall<{
          organizations: OrganizationInterface[];
          total: number;
        }>(`/admin/organizations?${params.toString()}`);
        setOrgs(res.organizations);
        setTotal(res.total);
        setError("");
      } catch (e) {
        setError(e.message);
      }

      setLoading(false);
    },
    [apiCall]
  );

  useEffect(() => {
    if (!superAdmin) return;

    loadOrgs(page, search);
    // eslint-disable-next-line
  }, [superAdmin]);

  const [orgModalOpen, setOrgModalOpen] = useState(false);

  if (!superAdmin) {
    return (
      <div className="alert alert-danger">
        Only super admins can view this page
      </div>
    );
  }

  return (
    <div className="container-fluid p-3 pagecontents">
      {orgModalOpen && (
        <CreateOrganization
          showExternalId={!isCloud()}
          onCreate={() => {
            loadOrgs(page, search);
          }}
          close={() => setOrgModalOpen(false)}
        />
      )}
      <h1>GrowthBook Admin</h1>
      {!isCloud() && (
        <div>
          <ShowLicenseInfo showInput={false} />{" "}
          <div className="divider border-bottom mb-3 mt-3" />
        </div>
      )}
      <h4>Organizations</h4>
      <button
        className="btn btn-primary float-right"
        onClick={(e) => {
          e.preventDefault();
          setOrgModalOpen(true);
        }}
      >
        <FaPlus /> New Organization
      </button>
      <p>Click an organization name below to switch to it.</p>
      <div className="mb-2 row align-items-center">
        <div className="col-auto">
          <form
            className="d-flex form form-inline"
            onSubmit={(e) => {
              e.preventDefault();
              setPage(1);
              loadOrgs(1, search);
            }}
          >
            <Field
              label="Search:"
              labelClassName="mr-2"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              type="search"
            />
            <div>
              <button type="submit" className="btn btn-primary ml-2">
                <FaSearch />
              </button>
            </div>
          </form>
        </div>
        <div className="col-auto">
          <span className="text-muted">
            {numberFormatter.format(total)} matching organization
            {total === 1 ? "" : "s"}
          </span>
        </div>
      </div>
      {error && <div className="alert alert-danger">{error}</div>}
      <div className="position-relative">
        {loading && <LoadingOverlay />}
        <table className="table appbox">
          <thead>
            <tr>
              <th>Name</th>
              <th>Owner</th>
              <th>Created</th>
              <th>Id</th>
              {!isCloud() && <th>External Id</th>}
              <th></th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {orgs.map((o) => (
              <OrganizationRow
                organization={o}
                showExternalId={!isCloud()}
                key={o.id}
                current={o.id === orgId}
                onEdit={() => {
                  loadOrgs(page, search);
                }}
                switchTo={(org) => {
                  if (setOrgId) {
                    setOrgId(org.id);
                  }
                  if (setSpecialOrg) {
                    setSpecialOrg(org);
                  }
                }}
              />
            ))}
          </tbody>
        </table>
        <Pagination
          currentPage={page}
          numItemsTotal={total}
          perPage={50}
          onPageChange={(page) => {
            setPage(page);
            loadOrgs(page, search);
          }}
        />
      </div>
      {!isCloud() && isMultiOrg() && (
        <div className="divider border-top mt-3">
          <OrphanedUsersList
            mutateUsers={() => {
              loadOrgs(page, search);
            }}
            numUsersInAccount={0}
            enableAdd={false}
          />
        </div>
      )}
    </div>
  );
};

export default Admin;

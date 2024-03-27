import { useEffect, useState } from "react";
import { OrganizationInterface } from "back-end/types/organization";
import { FaPlus, FaSearch } from "react-icons/fa";
import { isCloud, isMultiOrg } from "@/services/env";
import { useUser } from "@/services/UserContext";
import OrphanedUsersList from "@/components/Settings/Team/OrphanedUsersList";
import Field from "@/components/Forms/Field";
import Pagination from "@/components/Pagination";
import LoadingOverlay from "@/components/LoadingOverlay";
import CreateOrganization from "@/components/Admin/CreateOrganization";
import { useAuth } from "@/services/auth";
import OrganizationRow from "./OrganizationRow";

const numberFormatter = new Intl.NumberFormat();

export default function OrgsTable({
  loading,
  error,
  orgs,
  total,
  loadOrgs,
}: {
  loading: boolean;
  error?: string;
  orgs: OrganizationInterface[];
  total: number;
  loadOrgs: (page: number, search: string) => Promise<void>;
}) {
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");

  const { superAdmin } = useUser();
  const { orgId, setOrgId, setSpecialOrg } = useAuth();

  const [orgModalOpen, setOrgModalOpen] = useState(false);

  useEffect(() => {
    if (!superAdmin) return;
    loadOrgs(page, query);
    // eslint-disable-next-line
  }, [superAdmin]);

  return (
    <>
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
              loadOrgs(1, query);
            }}
          >
            <Field
              label="Search:"
              labelClassName="mr-2"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
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
                onUpdate={() => {
                  loadOrgs(page, query);
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
            loadOrgs(page, query);
          }}
        />
      </div>
      {orgModalOpen && (
        <CreateOrganization
          showExternalId={!isCloud()}
          onCreate={() => {
            loadOrgs(page, query);
          }}
          close={() => setOrgModalOpen(false)}
        />
      )}
      {!isCloud() && isMultiOrg() && (
        <div className="divider border-top mt-3">
          <OrphanedUsersList
            mutateUsers={() => {
              loadOrgs(page, query);
            }}
            numUsersInAccount={0}
            enableAdd={false}
          />
        </div>
      )}
    </>
  );
}

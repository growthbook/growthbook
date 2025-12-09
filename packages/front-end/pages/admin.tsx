import { FC, useCallback, useEffect, useState } from "react";
import {
  ExpandedMember,
  OrganizationInterface,
} from "back-end/types/organization";
import clsx from "clsx";
import { Box } from "@radix-ui/themes";
import {
  FaAngleDown,
  FaAngleRight,
  FaPencilAlt,
  FaPlus,
  FaSearch,
  FaSpinner,
} from "react-icons/fa";
import { date } from "shared/dates";
import stringify from "json-stringify-pretty-compact";
import Collapsible from "react-collapsible";
import { LicenseInterface } from "shared/enterprise";
import { DataSourceInterface } from "back-end/types/datasource";
import Field from "@/components/Forms/Field";
import Pagination from "@/components/Pagination";
import { useUser } from "@/services/UserContext";
import Code from "@/components/SyntaxHighlighting/Code";
import OrphanedUsersList from "@/components/Settings/Team/OrphanedUsersList";
import { isCloud, isMultiOrg } from "@/services/env";
import EditOrganization from "@/components/Admin/EditOrganization";
import LoadingOverlay from "@/components/LoadingOverlay";
import CreateOrganization from "@/components/Admin/CreateOrganization";
import ShowLicenseInfo from "@/components/License/ShowLicenseInfo";
import { useAuth } from "@/services/auth";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import Modal from "@/components/Modal";
import Switch from "@/ui/Switch";
import LoadingSpinner from "@/components/LoadingSpinner";
import ConfirmButton from "@/components/Modal/ConfirmButton";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableColumnHeader,
  TableCell,
} from "@/ui/Table";

interface memberOrgProps {
  id: string;
  name: string;
  members: number;
  role: string;
}
interface ssoInfoProps {
  id: string;
  emailDomains: string[];
  organization: string;
}
const numberFormatter = new Intl.NumberFormat();

function OrganizationRow({
  organization,
  current,
  switchTo,
  showExternalId,
  showVerfiedDomain,
  onEdit,
  ssoInfo,
  datasources,
}: {
  organization: OrganizationInterface;
  switchTo: (organization: OrganizationInterface) => void;
  current: boolean;
  showExternalId: boolean;
  showVerfiedDomain: boolean;
  onEdit: () => void;
  ssoInfo: ssoInfoProps | undefined;
  datasources: DataSourceInterface[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [editOrgModalOpen, setEditOrgModalOpen] = useState(false);
  const [orgMembers, setOrgMembers] = useState<Map<
    string,
    ExpandedMember
  > | null>(null);
  const { settings, members, ...otherAttributes } = organization;
  const [license, setLicense] = useState<LicenseInterface | null>(null);
  const [licenseLoading, setLicenseLoading] = useState(false);
  const { apiCall } = useAuth();
  const [clickhouseModalOpen, setClickhouseModalOpen] = useState(false);
  const [managedWarehouseId, setManagedWarehouseId] = useState(
    datasources.find((ds) => ds.type === "growthbook_clickhouse")?.id || null,
  );

  useEffect(() => {
    if (isCloud() && expanded && !license) {
      const fetchLicense = async () => {
        setLicenseLoading(true);
        const res = await apiCall<{
          status: number;
          licenseData: LicenseInterface;
        }>(`/license`, {
          method: "GET",
          headers: { "X-Organization": organization.id },
        });

        setLicenseLoading(false);
        if (res.status !== 200) {
          throw new Error("There was an error fetching the license");
        }

        setLicense(res.licenseData);
      };

      fetchLicense();
    }
  }, [expanded, apiCall, license, organization]);

  useEffect(() => {
    if (expanded && !orgMembers) {
      const fetchOrgMembers = async () => {
        const res = await apiCall<{
          members: ExpandedMember[];
        }>(`/admin/organization/${organization.id}/members`);

        const memberMap = new Map();
        if (res.members.length > 0) {
          res.members.forEach((member) => {
            memberMap.set(member.id, member);
          });
        }
        setOrgMembers(memberMap);
      };

      fetchOrgMembers();
    }
  }, [expanded, apiCall, orgMembers, organization]);

  const createClickhouseDatasource = async () => {
    const { id } = await apiCall<{ id: string }>(
      `/datasources/managed-warehouse`,
      {
        method: "POST",
        headers: { "X-Organization": organization.id },
      },
    );
    setClickhouseModalOpen(false);
    setManagedWarehouseId(id);
  };

  return (
    <>
      {editOrgModalOpen && (
        <EditOrganization
          id={organization.id}
          disablable={!current}
          currentOrg={organization}
          onEdit={onEdit}
          close={() => setEditOrgModalOpen(false)}
        />
      )}
      {clickhouseModalOpen && (
        <Modal
          open={true}
          header="Create Clickhouse Data Source"
          close={() => setClickhouseModalOpen(false)}
          submit={createClickhouseDatasource}
          cta="Yes"
          trackingEventModalType=""
        >
          Are you sure you want to create a Managed Warehouse data source for
          this organization?
        </Modal>
      )}
      <TableRow
        className={clsx({
          "table-warning": current,
          "table-danger": organization.disabled,
        })}
      >
        <td>
          <a
            className={clsx("mb-1 h5")}
            href="#"
            onClick={(e) => {
              e.preventDefault();
              switchTo(organization);
            }}
          >
            {organization.name}
          </a>
        </TableCell>
        <td>{organization.ownerEmail}</TableCell>
        <td>{date(organization.dateCreated)}</TableCell>
        <td>
          <small>{organization.id}</small>
        </TableCell>
        {showVerfiedDomain && (
          <td>
            <small>{organization.verifiedDomain}</small>
          </TableCell>
        )}
        {showExternalId && (
          <td>
            <small>{organization.externalId}</small>
          </TableCell>
        )}
        <td>{organization.members.length ?? 0}</TableCell>
        <TableCell className="p-0 text-center">
          <a
            href="#"
            className="d-block w-100 h-100"
            onClick={(e) => {
              e.preventDefault();
              setEditOrgModalOpen(true);
            }}
            style={{ lineHeight: "40px" }}
          >
            <FaPencilAlt />
          </a>
        </TableCell>
        <TableCell style={{ width: 40 }} className="p-0 text-center">
          <a
            href="#"
            className="d-block w-100 h-100"
            onClick={(e) => {
              e.preventDefault();
              setExpanded(!expanded);
            }}
            style={{ fontSize: "1.2em", lineHeight: "40px" }}
          >
            {expanded ? <FaAngleDown /> : <FaAngleRight />}
          </a>
        </TableCell>
      </TableRow>
      {expanded && (
        <tr>
          <TableCell colSpan={isCloud() ? 9 : 8} className="bg-light">
            <h3>Summary</h3>
            <div
              className="mb-3 bg-white border p-3"
              style={{ border: "1px solid var(--border-color-200)" }}
            >
              <div className="row">
                <div className="col-2 text-right">Name:</div>
                <div className="col-auto font-weight-bold">
                  {organization.name}
                </div>
              </div>
              <div className="row">
                <div className="col-2 text-right">ID:</div>
                <div className="col-auto font-weight-bold">
                  {organization.id}
                </div>
              </div>
              <div className="row">
                <div className="col-2 text-right">Verified Domain:</div>
                <div className="col-auto font-weight-bold">
                  {organization.verifiedDomain}
                </div>
              </div>
              <div className="row">
                <div className="col-2 text-right">Auto Approve Members:</div>
                <div className="col-auto font-weight-bold">
                  {organization.autoApproveMembers ? "on" : "off"}
                </div>
              </div>
              <div className="row">
                <div className="col-2 text-right">SSO Enabled:</div>
                <div className="col-auto font-weight-bold">
                  {ssoInfo
                    ? `yes (${
                        ssoInfo.id
                      } for domains: ${ssoInfo.emailDomains.join(", ")})`
                    : "no"}
                </div>
              </div>
              <div className="row">
                <div className="col-2 text-right">Restrict Login Method:</div>
                <div className="col-auto font-weight-bold">
                  {organization?.restrictLoginMethod ? "yes" : "no"}
                </div>
              </div>
              <div className="row">
                <div className="col-2 text-right">Num Members:</div>
                <div className="col-auto font-weight-bold">
                  {organization.members.length}
                </div>
              </div>
              <div className="row">
                <div className="col-2 text-right">Num Invited:</div>
                <div className="col-auto font-weight-bold">
                  {organization.invites.length}
                </div>
              </div>
              {isCloud() && (
                <>
                  <div className="row">
                    <div className="col-2 text-right">Enterprise (legacy):</div>
                    <div className="col-auto font-weight-bold">
                      {organization?.enterprise ? "yes" : "no"}
                    </div>
                  </div>
                  <div className="row">
                    <div className="col-2 text-right">License Key:</div>
                    <div className="col-auto font-weight-bold">
                      {organization?.licenseKey ? organization.licenseKey : "-"}
                    </div>
                  </div>
                  {((license || licenseLoading) && (
                    <div className="row">
                      <div className="col-2 text-right">Seats</div>
                      <div className="col-auto font-weight-bold">
                        {licenseLoading && <LoadingSpinner />}
                        {license && license.seats}
                      </div>
                    </div>
                  )) || // Only show free seats if they are on a free plan, ie. there is no license, no subscription, nor are they on a legacy enterprise
                    (!organization?.enterprise && (
                      <div className="row">
                        <div className="col-2 text-right">Free Seats:</div>
                        <div className="col-auto font-weight-bold">
                          {organization?.freeSeats ?? 3}
                        </div>
                      </div>
                    ))}
                  <div className="row">
                    <div className="col-2 text-right">Managed Warehouse</div>
                    <div className="col-auto">
                      {managedWarehouseId ? (
                        <ConfirmButton
                          onClick={async () => {
                            await apiCall(
                              `/datasource/${managedWarehouseId}/recreate-managed-warehouse`,
                              {
                                method: "POST",
                                headers: { "X-Organization": organization.id },
                              },
                            );
                          }}
                          confirmationText={
                            <span>
                              Are you sure? This may take several minutes and
                              all queries during this time will fail.
                            </span>
                          }
                          modalHeader="Drop and Recreate Managed Warehouse"
                        >
                          <button className="btn btn-danger">
                            Drop and Recreate Database
                          </button>
                        </ConfirmButton>
                      ) : (
                        <a
                          href="#"
                          className={"btn btn-primary"}
                          onClick={(e) => {
                            e.preventDefault();
                            setClickhouseModalOpen(true);
                          }}
                        >
                          Create Database
                        </a>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className="mb-3">
              <Collapsible
                trigger={
                  <h3>
                    Other Attributes <FaAngleRight className="chevron" />
                  </h3>
                }
                transitionTime={150}
              >
                <Code language="json" code={stringify(otherAttributes)} />
              </Collapsible>
            </div>
            <div className="mb-3">
              <Collapsible
                trigger={
                  <h3>
                    Settings <FaAngleRight className="chevron" />
                  </h3>
                }
                transitionTime={150}
              >
                <Code language="json" code={stringify(settings)} />
              </Collapsible>
            </div>
            <Collapsible
              trigger={
                <h3>
                  Members <FaAngleRight className="chevron" />
                </h3>
              }
              transitionTime={150}
            >
              <Code
                language="json"
                code={stringify(
                  members.map((m) => {
                    const mInfo = orgMembers?.get(m.id) ?? null;
                    return {
                      name: mInfo?.name ?? "-",
                      email: mInfo?.email ?? "-",
                      ...m,
                    };
                  }),
                )}
              />
            </Collapsible>
            {isCloud() && (
              <div className="mt-3">
                <Collapsible
                  trigger={
                    <h3>
                      License <FaAngleRight className="chevron" />
                    </h3>
                  }
                  transitionTime={150}
                >
                  {licenseLoading && <FaSpinner />}
                  {(license && (
                    <Code language="json" code={stringify(license)} />
                  )) ||
                    "No license found for this organization."}
                </Collapsible>
              </div>
            )}
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function MemberRow({
  member,
  current,
  memberOrgs,
  onEdit,
}: {
  member: ExpandedMember;
  current: boolean;
  memberOrgs: memberOrgProps[];
  onEdit: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editMemberModalOpen, setEditMemberModalOpen] = useState(false);

  return (
    <>
      {editMemberModalOpen && (
        <EditMember
          member={member}
          onEdit={onEdit}
          close={() => setEditMemberModalOpen(false)}
        />
      )}
      <TableRow
        className={clsx({
          "table-warning": current,
        })}
      >
        <td>{member.name}</TableCell>
        <td>{member.email}</TableCell>
        <td>{member.id}</TableCell>
        <td>{member.dateCreated ? date(member.dateCreated) : "-"}</TableCell>
        <td>{member.verified ? "Yes" : "No"}</TableCell>
        <td>
          {memberOrgs.length ? memberOrgs.map((mo) => mo.name).join(", ") : "-"}
        </TableCell>
        <TableCell className="p-0 text-center">
          <a
            href="#"
            className="d-block w-100 h-100"
            onClick={(e) => {
              e.preventDefault();
              setEditMemberModalOpen(true);
            }}
            style={{ lineHeight: "40px" }}
          >
            <FaPencilAlt />
          </a>
        </TableCell>
        <TableCell style={{ width: 40 }} className="p-0 text-center">
          <a
            href="#"
            className="d-block w-100 h-100"
            onClick={(e) => {
              e.preventDefault();
              setExpanded(!expanded);
            }}
            style={{ fontSize: "1.2em", lineHeight: "40px" }}
          >
            {expanded ? <FaAngleDown /> : <FaAngleRight />}
          </a>
        </TableCell>
      </TableRow>
      {expanded && (
        <tr>
          <TableCell colSpan={isCloud() ? 9 : 8} className="bg-light">
            <div className="mb-3">
              <h4>Organization Info</h4>
              <div className="row">
                {memberOrgs.length === 0 && (
                  <div className="col">No organizations found</div>
                )}
                {memberOrgs.map((o) => (
                  <div
                    className="mb-2 mx-2 col-3 border bg-white p-3 rounded-lg"
                    key={o.id + member.id}
                  >
                    <div>
                      <span className="font-weight-bold">Name:</span> {o.name}
                    </div>
                    <div>
                      <span className="font-weight-bold">Org Id:</span> {o.id}
                    </div>
                    <div>
                      <span className="font-weight-bold">Members:</span>{" "}
                      {o.members}
                    </div>
                    <div>
                      <span className="font-weight-bold">Role:</span> {o.role}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

const Admin: FC = () => {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");

  const [memberPage, setMemberPage] = useState(1);
  const [memberSearch, setMemberSearch] = useState("");

  const { orgId, setOrgId, setSpecialOrg, apiCall } = useAuth();

  const { license, superAdmin } = useUser();
  const [orgs, setOrgs] = useState<OrganizationInterface[]>([]);
  const [ssoConnections, setSsoConnections] = useState<ssoInfoProps[]>([]);
  const [datasources, setDatasources] = useState<DataSourceInterface[]>([]);
  const [total, setTotal] = useState(0);
  const [members, setMembers] = useState<ExpandedMember[]>([]);
  const [memberOrgs, setMemberOrgs] = useState<{
    string?: memberOrgProps[];
  }>({});
  const [totalMembers, setTotalMembers] = useState(0);
  const [error, setError] = useState("");
  const [memberError, setMemberError] = useState("");
  const [loading, setLoading] = useState(false);
  const [memberLoading, setMemberLoading] = useState(false);

  const loadOrgs = useCallback(
    async (page: number, search: string) => {
      setLoading(true);
      const params = new URLSearchParams();

      params.append("page", page + "");
      params.append("search", search);

      try {
        const res = await apiCall<{
          organizations: OrganizationInterface[];
          ssoConnections: ssoInfoProps[];
          datasources: DataSourceInterface[];
          total: number;
        }>(`/admin/organizations?${params.toString()}`);
        setOrgs(res.organizations);
        setTotal(res.total);
        setSsoConnections(res.ssoConnections);
        setDatasources(res.datasources);
        setError("");
      } catch (e) {
        setError(e.message);
      }

      setLoading(false);
    },
    [apiCall],
  );

  const loadMembers = useCallback(
    async (page: number, search: string) => {
      setMemberLoading(true);
      const params = new URLSearchParams();

      params.append("page", page + "");
      params.append("search", search);

      try {
        const res = await apiCall<{
          members: ExpandedMember[];
          total: number;
          memberOrgs: { string: memberOrgProps[] };
        }>(`/admin/members?${params.toString()}`);
        setMembers(res.members);
        setMemberOrgs(res.memberOrgs);
        setTotalMembers(res.total);
        setMemberError("");
      } catch (e) {
        setError(e.message);
      }

      setMemberLoading(false);
    },
    [apiCall],
  );

  useEffect(() => {
    if (!superAdmin) return;

    loadOrgs(page, search);
    loadMembers(memberPage, memberSearch);
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
  if (!isCloud() && license?.plan != "enterprise") {
    return (
      <div className="alert alert-danger">
        You must be on an enterprise license to view this page
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
        <>
          <div
            className="p-3 bg-white"
            style={{ border: "1px solid var(--border-color-200)" }}
          >
            <ShowLicenseInfo showInput={false} />{" "}
          </div>
          <div className="divider border-bottom mb-3 mt-3" />
        </>
      )}
      <Tabs defaultValue="organizations" persistInURL={true}>
        <Box mb="3">
          <TabsList>
            <TabsTrigger value="organizations">Organizations</TabsTrigger>
            <TabsTrigger value="members">Members</TabsTrigger>
          </TabsList>
        </Box>

        <TabsContent value="organizations">
          <button
            className="btn btn-primary float-right"
            onClick={(e) => {
              e.preventDefault();
              setOrgModalOpen(true);
            }}
          >
            <FaPlus /> New Organization
          </button>
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
            <Table variant="standard" className="appbox" style={{ tableLayout: "fixed" }}>
              <thead>
                <tr>
                  <th>Name</TableColumnHeader>
                  <TableColumnHeader style={{ width: "260px" }}>Owner</TableColumnHeader>
                  <th>Created</TableColumnHeader>
                  <th>Id</TableColumnHeader>
                  {isCloud() && <th>Verified Domain</TableColumnHeader>}
                  {!isCloud() && <th>External Id</TableColumnHeader>}
                  <TableColumnHeader style={{ width: "120px" }}>Members</TableColumnHeader>
                  <TableColumnHeader style={{ width: "14px" }}></TableColumnHeader>
                  <TableColumnHeader style={{ width: "40px" }}></TableColumnHeader>
                </TableRow>
              </TableHeader>
              <tbody>
                {orgs.map((o) => (
                  <OrganizationRow
                    organization={o}
                    ssoInfo={ssoConnections.find(
                      (sso) => sso.organization === o.id,
                    )}
                    datasources={datasources.filter(
                      (ds) => ds.organization === o.id,
                    )}
                    showExternalId={!isCloud()}
                    showVerfiedDomain={isCloud()}
                    key={o.id}
                    current={o.id === orgId}
                    onEdit={() => {
                      loadOrgs(page, search);
                    }}
                    switchTo={(org) => {
                      if (setOrgId) {
                        setOrgId(org.id);
                      }
                      try {
                        localStorage.setItem(
                          "gb-last-picked-org",
                          `"${org.id}"`,
                        );
                      } catch (e) {
                        console.warn("Cannot set gb-last-picked-org");
                      }
                      if (setSpecialOrg) {
                        setSpecialOrg(org);
                      }
                    }}
                  />
                ))}
              </TableBody>
            </Table>
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
        </TabsContent>

        <TabsContent value="members">
          <div className="mb-2 row align-items-center">
            <div className="col-auto">
              <form
                className="d-flex form form-inline"
                onSubmit={(e) => {
                  e.preventDefault();
                  setMemberPage(1);
                  loadMembers(1, memberSearch);
                }}
              >
                <Field
                  label="Search:"
                  labelClassName="mr-2"
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
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
                {numberFormatter.format(totalMembers)}{" "}
                {memberSearch ? "matching" : ""} member
                {totalMembers === 1 ? "" : "s"}
              </span>
            </div>
          </div>
          {memberError && (
            <div className="alert alert-danger">{memberError}</div>
          )}
          <div className="position-relative">
            {memberLoading && <LoadingOverlay />}
            <Table variant="standard" className="appbox" style={{ tableLayout: "fixed" }}>
              <thead>
                <tr>
                  <th>Name</TableColumnHeader>
                  <th>email</TableColumnHeader>
                  <th>Id</TableColumnHeader>
                  <th>Created</TableColumnHeader>
                  <TableColumnHeader title="Verified Email">Verified</TableColumnHeader>
                  <th>Orgs</TableColumnHeader>
                  <TableColumnHeader style={{ width: 40 }}></TableColumnHeader>
                  <TableColumnHeader style={{ width: 40 }}></TableColumnHeader>
                </TableRow>
              </TableHeader>
              <tbody>
                {members.map((m) => (
                  <MemberRow
                    member={m}
                    memberOrgs={memberOrgs[m.id] ?? []}
                    key={m.id}
                    current={m.id === orgId}
                    onEdit={() => {
                      loadMembers(memberPage, memberSearch);
                    }}
                  />
                ))}
              </TableBody>
            </Table>
            <Pagination
              currentPage={memberPage}
              numItemsTotal={totalMembers}
              perPage={50}
              onPageChange={(page) => {
                setMemberPage(page);
                loadMembers(memberPage, memberSearch);
              }}
            />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

const EditMember: FC<{
  onEdit: () => void;
  close?: () => void;
  member: ExpandedMember;
}> = ({ onEdit, close, member }) => {
  const [verified, setVerified] = useState(member.verified);
  const [name, setName] = useState(member.name);
  const [email, setEmail] = useState(member.email);

  const { apiCall } = useAuth();

  const handleSubmit = async () => {
    await apiCall<{
      status: number;
      message?: string;
    }>("/admin/member", {
      method: "PUT",
      body: JSON.stringify({
        userId: member.id,
        verified: verified,
        email: email,
        name: name,
      }),
    });
    onEdit();
  };

  return (
    <Modal
      trackingEventModalType=""
      submit={handleSubmit}
      open={true}
      header={"Edit Member"}
      cta={"Update"}
      close={close}
      inline={!close}
    >
      <div className="form-group">
        Name
        <input
          type="text"
          className="form-control"
          value={name}
          required
          minLength={3}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="mt-3">
          Email
          <input
            type="email"
            className="form-control"
            value={email}
            required
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="mt-4">
          <Switch
            label="Verified Email"
            id="verified"
            value={verified}
            onChange={(e) => setVerified(e)}
          />
        </div>
      </div>
    </Modal>
  );
};

export default Admin;

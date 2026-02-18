import { FC, useCallback, useEffect, useState } from "react";
import {
  ExpandedMember,
  OrganizationInterface,
} from "shared/types/organization";
import clsx from "clsx";
import { Box, useThemeContext } from "@radix-ui/themes";
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
import { DataSourceInterface } from "shared/types/datasource";
import { SSOConnectionInterface } from "shared/types/sso-connection";
import { useForm } from "react-hook-form";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer-continued";
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
import SelectField from "@/components/Forms/SelectField";
import StringArrayField from "@/components/Forms/StringArrayField";
import Checkbox from "@/ui/Checkbox";

interface memberOrgProps {
  id: string;
  name: string;
  members: number;
  role: string;
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
  ssoInfo: SSOConnectionInterface | undefined;
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
  const [editSSOOpen, setEditSSOOpen] = useState(false);

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
      {editSSOOpen && (
        <EditSSOModal
          close={() => setEditSSOOpen(false)}
          organizationId={organization.id}
          organizationName={organization.name}
          currentSSO={ssoInfo}
          enforced={
            !!organization.restrictLoginMethod &&
            organization.restrictLoginMethod === ssoInfo?.id
          }
          onSave={onEdit}
        />
      )}
      <tr
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
        </td>
        <td>{organization.ownerEmail}</td>
        <td>{date(organization.dateCreated)}</td>
        <td>
          <small>{organization.id}</small>
        </td>
        {showVerfiedDomain && (
          <td>
            <small>{organization.verifiedDomain}</small>
          </td>
        )}
        {showExternalId && (
          <td>
            <small>{organization.externalId}</small>
          </td>
        )}
        <td>{organization.members.length ?? 0}</td>
        <td className="p-0 text-center">
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
        </td>
        <td style={{ width: 40 }} className="p-0 text-center">
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
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={8} className="bg-light">
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
                      } for domains: ${ssoInfo.emailDomains?.join(", ")})`
                    : "no"}
                </div>
                {isCloud() && (
                  <div className="col-auto">
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault();
                        setEditSSOOpen(true);
                      }}
                    >
                      Edit
                    </a>
                  </div>
                )}
              </div>
              <div className="row">
                <div className="col-2 text-right">Restrict Login Method:</div>
                <div className="col-auto font-weight-bold">
                  {organization?.restrictLoginMethod || "no"}
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
                          <a href="#" className="text-danger">
                            Drop and Recreate Database
                          </a>
                        </ConfirmButton>
                      ) : (
                        <a
                          href="#"
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
          </td>
        </tr>
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
      <tr
        className={clsx({
          "table-warning": current,
        })}
      >
        <td>{member.name}</td>
        <td>{member.email}</td>
        <td>{member.id}</td>
        <td>{member.dateCreated ? date(member.dateCreated) : "-"}</td>
        <td>{member.verified ? "Yes" : "No"}</td>
        <td>
          {memberOrgs.length ? memberOrgs.map((mo) => mo.name).join(", ") : "-"}
        </td>
        <td className="p-0 text-center">
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
        </td>
        <td style={{ width: 40 }} className="p-0 text-center">
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
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={8} className="bg-light">
            <div className="mb-3">
              <h4>Organization Info</h4>
              <div className="row">
                {memberOrgs.length === 0 && (
                  <div className="col">No organizations found</div>
                )}
                {memberOrgs.map((o) => (
                  <div className="mb-2 col-3" key={o.id + member.id}>
                    <div className="mx-2  border bg-white p-3 rounded-lg">
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
                  </div>
                ))}
              </div>
            </div>
          </td>
        </tr>
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
  const [ssoConnections, setSsoConnections] = useState<
    SSOConnectionInterface[]
  >([]);
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
          ssoConnections: SSOConnectionInterface[];
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
            <table className="table appbox" style={{ tableLayout: "fixed" }}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th style={{ width: "260px" }}>Owner</th>
                  <th>Created</th>
                  <th>Id</th>
                  {isCloud() && <th>Verified Domain</th>}
                  {!isCloud() && <th>External Id</th>}
                  <th style={{ width: "120px" }}>Members</th>
                  <th style={{ width: "14px" }}></th>
                  <th style={{ width: "40px" }}></th>
                </tr>
              </thead>
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
            <table className="table appbox" style={{ tableLayout: "fixed" }}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>email</th>
                  <th>Id</th>
                  <th>Created</th>
                  <th title="Verified Email">Verified</th>
                  <th>Orgs</th>
                  <th style={{ width: 40 }}></th>
                  <th style={{ width: 40 }}></th>
                </tr>
              </thead>
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
              </tbody>
            </table>
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

function generateSSOConnection(
  data: SSOConnectionInterface,
): SSOConnectionInterface {
  const res: SSOConnectionInterface = {
    ...data,
  };

  // Generate additionalScope, extraQueryParams, metadata based on idP type
  if (data.idpType === "okta") {
    if (data.baseURL) {
      // Remove trailing slash
      const baseURL = data.baseURL.replace(/\/+$/, "");

      res.additionalScope = "offline_access";
      res.extraQueryParams = undefined;
      res.metadata = {
        issuer: `${baseURL}`,
        authorization_endpoint: `${baseURL}/oauth2/v1/authorize`,
        id_token_signing_alg_values_supported: ["RS256"],
        jwks_uri: `${baseURL}/oauth2/v1/keys`,
        token_endpoint: `${baseURL}/oauth2/v1/token`,
        code_challenge_methods_supported: ["S256"],
      };
    }
  } else if (data.idpType === "google") {
    res.extraQueryParams = {
      access_type: "offline",
      prompt: "consent",
    };
    res.additionalScope = "";
    res.metadata = {
      issuer: "https://accounts.google.com",
      authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
      token_endpoint: "https://oauth2.googleapis.com/token",
      jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
      id_token_signing_alg_values_supported: ["RS256"],
      code_challenge_methods_supported: ["S256"],
    };
  } else if (data.idpType === "auth0") {
    if (data.tenantId) {
      res.additionalScope = "offline_access";
      res.extraQueryParams = undefined;
      res.metadata = {
        issuer: `https://${data.tenantId}.auth0.com/`,
        authorization_endpoint: `https://${data.tenantId}.auth0.com/authorize`,
        logout_endpoint: `https://${data.tenantId}.auth0.com/v2/logout?client_id=CLIENT_ID`,
        id_token_signing_alg_values_supported: ["HS256", "RS256"],
        jwks_uri: `https://${data.tenantId}.auth0.com/.well-known/jwks.json`,
        token_endpoint: `https://${data.tenantId}.auth0.com/oauth/token`,
        code_challenge_methods_supported: ["S256", "plain"],
        audience: data.audience || "",
      };
    }
  } else if (data.idpType === "azure") {
    if (data.tenantId) {
      res.additionalScope = "offline_access";
      res.extraQueryParams = undefined;
      res.metadata = {
        token_endpoint: `https://login.microsoftonline.com/${data.tenantId}/oauth2/v2.0/token`,
        jwks_uri: `https://login.microsoftonline.com/${data.tenantId}/discovery/v2.0/keys`,
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
        issuer: `https://login.microsoftonline.com/${data.tenantId}/v2.0`,
        authorization_endpoint: `https://login.microsoftonline.com/${data.tenantId}/oauth2/v2.0/authorize`,
        logout_endpoint: `https://login.microsoftonline.com/${data.tenantId}/oauth2/v2.0/logout`,
      };
    }
  } else if (data.idpType === "onelogin") {
    if (data.baseURL) {
      // Remove trailing slash
      const baseURL = data.baseURL.replace(/\/+$/, "");
      res.additionalScope = "";
      res.extraQueryParams = undefined;
      res.metadata = {
        issuer: `${baseURL}/oidc/2`,
        authorization_endpoint: `${baseURL}/oidc/2/auth`,
        token_endpoint: `${baseURL}/oidc/2/token`,
        id_token_signing_alg_values_supported: ["RS256", "HS256", "PS256"],
        jwks_uri: `${baseURL}/oidc/2/certs`,
        code_challenge_methods_supported: ["S256"],
        logout_endpoint: `${baseURL}/oidc/2/logout`,
      };
    }
  } else if (data.idpType === "jumpcloud") {
    res.additionalScope = "offline_access";
    res.extraQueryParams = undefined;
    res.metadata = {
      token_endpoint: "https://oauth.id.jumpcloud.com/oauth2/token",
      jwks_uri: "https://oauth.id.jumpcloud.com/.well-known/jwks.json",
      id_token_signing_alg_values_supported: ["RS256"],
      code_challenge_methods_supported: ["S256"],
      issuer: "https://oauth.id.jumpcloud.com/",
      authorization_endpoint: "https://oauth.id.jumpcloud.com/oauth2/auth",
      logout_endpoint: "https://oauth.id.jumpcloud.com/oauth2/sessions/logout",
      audience: "",
    };
  }

  return res;
}

function jsonSafeParse(str: string) {
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch (e) {
    return null;
  }
}

function EditSSOModal({
  close,
  organizationId,
  organizationName,
  currentSSO,
  enforced,
  onSave,
}: {
  close: () => void;
  organizationId: string;
  organizationName: string;
  currentSSO?: SSOConnectionInterface;
  enforced?: boolean;
  onSave?: () => void;
}) {
  const { apiCall } = useAuth();

  const [enforceSSO, setEnforceSSO] = useState<boolean>(enforced || false);

  const form = useForm<
    Omit<SSOConnectionInterface, "metadata"> & {
      metadata: string;
    }
  >({
    defaultValues: {
      id: currentSSO?.id || "",
      organization: organizationId,
      clientId: currentSSO?.clientId || "",
      clientSecret: currentSSO?.clientSecret || "",
      additionalScope: currentSSO?.additionalScope || "",
      metadata: currentSSO?.metadata ? JSON.stringify(currentSSO.metadata) : "",
      emailDomains: currentSSO?.emailDomains || [],
      idpType: currentSSO?.idpType,
      extraQueryParams: currentSSO?.extraQueryParams || undefined,
      baseURL: currentSSO?.baseURL || "",
      tenantId: currentSSO?.tenantId || "",
      audience: currentSSO?.audience || "",
    },
  });

  const currentValue = {
    id: form.watch("id"),
    organization: form.watch("organization"),
    clientId: form.watch("clientId"),
    clientSecret: form.watch("clientSecret"),
    additionalScope: form.watch("additionalScope"),
    metadata: jsonSafeParse(form.watch("metadata")) || {},
    emailDomains: form.watch("emailDomains"),
    idpType: form.watch("idpType"),
    extraQueryParams: form.watch("extraQueryParams"),
    baseURL: form.watch("baseURL"),
    tenantId: form.watch("tenantId"),
    audience: form.watch("audience"),
  };

  const { appearance } = useThemeContext();

  if (!isCloud()) {
    return null;
  }

  return (
    <Modal
      trackingEventModalType=""
      submit={form.handleSubmit(async (data) => {
        const payload = generateSSOConnection({
          ...data,
          metadata: jsonSafeParse(data.metadata) || {},
        });

        await apiCall(`/admin/sso-connection`, {
          method: "POST",
          body: JSON.stringify({
            ...payload,
            enforceSSO: enforceSSO,
          }),
          headers: { "X-Organization": organizationId },
        });

        onSave && onSave();
      })}
      open={true}
      header={currentSSO ? "Edit SSO Connection" : "Create SSO Connection"}
      cta={currentSSO ? "Save Changes" : "Create Connection"}
      close={close}
      size="max"
    >
      <h3>Organization: {organizationName}</h3>

      <SelectField
        label="Identity Provider Type"
        value={currentValue.idpType || ""}
        onChange={(idpType) =>
          form.setValue("idpType", idpType as SSOConnectionInterface["idpType"])
        }
        options={[
          { label: "Okta", value: "okta" },
          { label: "Azure/Entra", value: "azure" },
          { label: "Google", value: "google" },
          { label: "OneLogin", value: "onelogin" },
          { label: "JumpCloud", value: "jumpcloud" },
          { label: "Auth0", value: "auth0" },
          { label: "Other OIDC", value: "oidc" },
        ]}
        initialOption="Select One..."
        required
      />

      <Field
        label="SSO Id"
        {...form.register("id")}
        pattern="^[a-zA-Z0-9_]+$"
        required
        disabled={!!currentSSO}
        helpText="A short id to identify this organization. Examples: 'acme', 'dunder_mifflin', 'initech'"
      />

      <Field label="Client ID" {...form.register("clientId")} required />

      <Field
        label="Client Secret"
        type="text"
        {...form.register("clientSecret")}
        placeholder={currentSSO ? "(unchanged)" : ""}
        required={!currentSSO}
      />

      <StringArrayField
        label="Email Domains"
        value={form.watch("emailDomains") || []}
        onChange={(emailDomains) => form.setValue("emailDomains", emailDomains)}
        required
      />

      {currentValue.idpType === "okta" ||
      currentValue.idpType === "onelogin" ? (
        <Field
          label="Base URL"
          {...form.register("baseURL")}
          type="url"
          required
        />
      ) : null}
      {currentValue.idpType === "azure" || currentValue.idpType === "auth0" ? (
        <Field label="Tenant ID" {...form.register("tenantId")} required />
      ) : null}
      {currentValue.idpType === "auth0" ? (
        <Field label="Audience" {...form.register("audience")} />
      ) : null}

      <Checkbox
        label="Enforce SSO Login"
        id="enforce-sso"
        value={enforceSSO}
        setValue={(v) => setEnforceSSO(v)}
      />

      {currentValue.idpType === "oidc" ? (
        <>
          <Field
            label="Additional Scope"
            {...form.register("additionalScope")}
          />
          <Field
            label="Metadata (JSON)"
            textarea
            {...form.register("metadata")}
            required
          />
        </>
      ) : currentSSO?.metadata ? (
        <>
          <h3 className="mt-3">Changes</h3>
          <ReactDiffViewer
            oldValue={sortObj(currentSSO)}
            newValue={sortObj(generateSSOConnection(currentValue))}
            compareMethod={DiffMethod.LINES}
            useDarkTheme={appearance === "dark"}
            styles={{
              contentText: {
                wordBreak: "break-all",
              },
            }}
          />
        </>
      ) : (
        <Code
          language="json"
          code={stringify(
            generateSSOConnection({
              ...form.getValues(),
              metadata: { issuer: "" },
            }),
          )}
          filename={"Preview"}
        />
      )}
    </Modal>
  );
}

function sortObj(obj: unknown): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(obj as { [key: string]: unknown })
        .filter(([k]) => k !== "_id" && k !== "__v" && k !== "dateCreated")
        .sort((a, b) => a[0].localeCompare(b[0])),
    ),
    null,
    2,
  );
}

export default Admin;

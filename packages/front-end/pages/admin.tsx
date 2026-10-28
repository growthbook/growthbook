import { FormEvent, useState } from "react";
import { OrganizationInterface } from "shared/types/organization";
import { Box, Flex } from "@radix-ui/themes";
import { PiMagnifyingGlass } from "react-icons/pi";
import { date } from "shared/dates";
import { SuperAdmin } from "shared/validators";
import {
  hasSuperAdminPermission,
  normalizeSuperAdmin,
} from "shared/permissions";
import { AdminOrgSummary } from "shared/enterprise";
import { useUser } from "@/services/UserContext";
import OrphanedUsersList from "@/components/Settings/Team/OrphanedUsersList";
import { isCloud, isMultiOrg } from "@/services/env";
import LoadingOverlay from "@/components/LoadingOverlay";
import CreateOrganization from "@/components/Admin/CreateOrganization";
import EditMember, { AdminMember } from "@/components/Admin/EditMember";
import { GBEdit } from "@/components/Icons";
import { PlanBadge, StatusBadge } from "@/components/Admin/OrgBadges";
import ShowLicenseInfo from "@/components/License/ShowLicenseInfo";
import useApi from "@/hooks/useApi";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import Button from "@/ui/Button";
import Checkbox from "@/ui/Checkbox";
import Callout from "@/ui/Callout";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
import Pagination from "@/ui/Pagination";
import { Select, SelectItem } from "@/ui/Select";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import Text from "@/ui/Text";
import TextField from "@/ui/TextField";

interface memberOrgProps {
  id: string;
  name: string;
  members: number;
  role: string;
}

const numberFormatter = new Intl.NumberFormat();

const MEMBER_RANGES: Record<string, { min?: number; max?: number }> = {
  "1-9": { min: 1, max: 9 },
  "10-49": { min: 10, max: 49 },
  "50+": { min: 50 },
};

function formatSuperAdmin(superAdmin: SuperAdmin | undefined) {
  const normalized = normalizeSuperAdmin(superAdmin);
  if (normalized === true) return "Full access";
  return normalized ? normalized.join(", ") : "-";
}

function OrganizationList() {
  const { superAdmin } = useUser();
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [plan, setPlan] = useState("all");
  const [status, setStatus] = useState("all");
  const [members, setMembers] = useState("all");
  const [createdDays, setCreatedDays] = useState("all");
  const [loginMethod, setLoginMethod] = useState("all");
  const [orgModalOpen, setOrgModalOpen] = useState(false);

  const params = new URLSearchParams({ page: String(page), search });
  if (plan !== "all") params.set("plan", plan);
  if (status !== "all") params.set("status", status);
  if (loginMethod !== "all") params.set("loginMethod", loginMethod);
  const range = MEMBER_RANGES[members];
  if (range?.min !== undefined) params.set("minMembers", String(range.min));
  if (range?.max !== undefined) params.set("maxMembers", String(range.max));
  if (createdDays !== "all") {
    // Midnight keeps the URL, and so the cache key, stable all day
    const createdAfter = new Date();
    createdAfter.setHours(0, 0, 0, 0);
    createdAfter.setDate(createdAfter.getDate() - Number(createdDays));
    params.set("createdAfter", createdAfter.toISOString());
  }

  const { data, error, mutate } = useApi<{
    organizations: OrganizationInterface[];
    summaries: Record<string, AdminOrgSummary>;
    total: number;
  }>(`/admin/organizations?${params.toString()}`);

  // Every filter change starts back on the first page
  const filterSetter = (set: (value: string) => void) => (value: string) => {
    set(value);
    setPage(1);
  };

  return (
    <>
      {orgModalOpen && (
        <CreateOrganization
          showExternalId={!isCloud()}
          onCreate={() => mutate()}
          close={() => setOrgModalOpen(false)}
        />
      )}
      <Flex align="center" justify="between" mb="3">
        <Heading as="h2" size="lg" mb="0">
          Organizations
        </Heading>
        {hasSuperAdminPermission(superAdmin, "create") && (
          <Button onClick={() => setOrgModalOpen(true)}>
            New organization
          </Button>
        )}
      </Flex>
      <Flex gap="2" wrap="wrap" align="center" mb="3">
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            setSearch(searchInput.trim());
            setPage(1);
          }}
          style={{ flex: "0 1 360px", minWidth: 240 }}
        >
          <TextField
            type="search"
            placeholder="Name, ID, domain, or owner email"
            prepend={<PiMagnifyingGlass aria-hidden />}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </form>
        {isCloud() && (
          <Select value={plan} setValue={filterSetter(setPlan)}>
            <SelectItem value="all">All plans</SelectItem>
            <SelectItem value="starter">Starter</SelectItem>
            <SelectItem value="pro">Pro</SelectItem>
            <SelectItem value="enterprise">Enterprise</SelectItem>
          </Select>
        )}
        <Select value={status} setValue={filterSetter(setStatus)}>
          <SelectItem value="all">All statuses</SelectItem>
          {isCloud() && <SelectItem value="trialing">Trial</SelectItem>}
          {isCloud() && <SelectItem value="past_due">Past due</SelectItem>}
          {isCloud() && <SelectItem value="canceled">Canceled</SelectItem>}
          <SelectItem value="suspended">Suspended</SelectItem>
          <SelectItem value="disabled">Disabled</SelectItem>
        </Select>
        <Select value={members} setValue={filterSetter(setMembers)}>
          <SelectItem value="all">Any number of members</SelectItem>
          <SelectItem value="1-9">1–9 members</SelectItem>
          <SelectItem value="10-49">10–49 members</SelectItem>
          <SelectItem value="50+">50+ members</SelectItem>
        </Select>
        <Select value={createdDays} setValue={filterSetter(setCreatedDays)}>
          <SelectItem value="all">Created any time</SelectItem>
          <SelectItem value="7">Created in the last 7 days</SelectItem>
          <SelectItem value="30">Created in the last 30 days</SelectItem>
          <SelectItem value="90">Created in the last 90 days</SelectItem>
          <SelectItem value="365">Created in the last year</SelectItem>
        </Select>
        {isCloud() && (
          <Select value={loginMethod} setValue={filterSetter(setLoginMethod)}>
            <SelectItem value="all">Any login method</SelectItem>
            <SelectItem value="sso">SSO</SelectItem>
            <SelectItem value="sso_required">SSO required</SelectItem>
            <SelectItem value="none">No SSO</SelectItem>
          </Select>
        )}
        {data && (
          <Text color="text-mid" ml="auto">
            {numberFormatter.format(data.total)} organization
            {data.total === 1 ? "" : "s"}
          </Text>
        )}
      </Flex>
      {error && (
        <Callout status="error" mb="3">
          {error.message}
        </Callout>
      )}
      <Box position="relative">
        {!data && !error && <LoadingOverlay />}
        <Table variant="list" stickyHeader>
          <TableHeader>
            <TableRow>
              <TableColumnHeader>Name</TableColumnHeader>
              <TableColumnHeader>ID</TableColumnHeader>
              {isCloud() && <TableColumnHeader>Plan</TableColumnHeader>}
              <TableColumnHeader>Status</TableColumnHeader>
              <TableColumnHeader>Members</TableColumnHeader>
              <TableColumnHeader>Created</TableColumnHeader>
              <TableColumnHeader>Owner</TableColumnHeader>
              {!isCloud() && <TableColumnHeader>External ID</TableColumnHeader>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.organizations.map((o) => {
              const summary = data.summaries[o.id];
              return (
                <TableRow key={o.id} style={{ whiteSpace: "nowrap" }}>
                  <TableCell>
                    <Link href={`/admin/${o.id}`} weight="bold">
                      {o.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <code>{o.id}</code>
                  </TableCell>
                  {isCloud() && (
                    <TableCell>
                      <PlanBadge plan={summary.plan} legacy={o.enterprise} />
                    </TableCell>
                  )}
                  <TableCell>
                    <StatusBadge status={summary.status} />
                  </TableCell>
                  <TableCell>
                    {o.members.length}
                    {summary.seats ? ` / ${summary.seats}` : ""}
                  </TableCell>
                  <TableCell>{date(o.dateCreated)}</TableCell>
                  <TableCell>{o.ownerEmail}</TableCell>
                  {!isCloud() && <TableCell>{o.externalId}</TableCell>}
                </TableRow>
              );
            })}
            {data?.organizations.length === 0 && (
              <TableRow>
                <TableCell colSpan={7}>
                  <Text color="text-mid">No organizations found</Text>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Box>
      {data && data.total > 50 && (
        <Pagination
          currentPage={page}
          numItemsTotal={data.total}
          perPage={50}
          onPageChange={setPage}
        />
      )}
      {!isCloud() &&
        isMultiOrg() &&
        hasSuperAdminPermission(superAdmin, "users") && (
          <Box mt="4">
            <OrphanedUsersList
              mutateUsers={() => mutate()}
              numUsersInAccount={0}
              enableAdd={false}
            />
          </Box>
        )}
    </>
  );
}

function MemberList() {
  const { superAdmin } = useUser();
  const canEdit =
    hasSuperAdminPermission(superAdmin, "users") ||
    hasSuperAdminPermission(superAdmin, "grant");
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [superAdminsOnly, setSuperAdminsOnly] = useState(false);
  const [editMember, setEditMember] = useState<AdminMember | null>(null);

  const params = new URLSearchParams({ page: String(page), search });
  if (superAdminsOnly) params.set("superAdmins", "1");

  const { data, error, mutate } = useApi<{
    members: AdminMember[];
    total: number;
    memberOrgs: Record<string, memberOrgProps[]>;
  }>(`/admin/members?${params.toString()}`);

  return (
    <>
      {editMember && (
        <EditMember
          member={editMember}
          onEdit={() => mutate()}
          close={() => setEditMember(null)}
        />
      )}
      <Flex gap="4" wrap="wrap" align="center" mb="3">
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            setSearch(searchInput.trim());
            setPage(1);
          }}
          style={{ flex: "0 1 360px", minWidth: 240 }}
        >
          <TextField
            type="search"
            placeholder="Name, email, or user ID"
            prepend={<PiMagnifyingGlass aria-hidden />}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </form>
        <Checkbox
          id="super-admins-only"
          label="Super admins only"
          value={superAdminsOnly}
          setValue={(v) => {
            setSuperAdminsOnly(v);
            setPage(1);
          }}
        />
        {data && (
          <Text color="text-mid" ml="auto">
            {numberFormatter.format(data.total)} member
            {data.total === 1 ? "" : "s"}
          </Text>
        )}
      </Flex>
      {error && (
        <Callout status="error" mb="3">
          {error.message}
        </Callout>
      )}
      <Box position="relative">
        {!data && !error && <LoadingOverlay />}
        <Table variant="list" stickyHeader>
          <TableHeader>
            <TableRow>
              <TableColumnHeader>Name</TableColumnHeader>
              <TableColumnHeader>Email</TableColumnHeader>
              <TableColumnHeader>ID</TableColumnHeader>
              <TableColumnHeader>Created</TableColumnHeader>
              <TableColumnHeader>Verified</TableColumnHeader>
              <TableColumnHeader>Super admin</TableColumnHeader>
              <TableColumnHeader>Organizations</TableColumnHeader>
              <TableColumnHeader />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.members.map((m) => {
              const orgs = data.memberOrgs[m.id] ?? [];
              return (
                <TableRow key={m.id} style={{ whiteSpace: "nowrap" }}>
                  <TableCell>{m.name}</TableCell>
                  <TableCell>{m.email}</TableCell>
                  <TableCell>
                    <code>{m.id}</code>
                  </TableCell>
                  <TableCell>
                    {m.dateCreated ? date(m.dateCreated) : "-"}
                  </TableCell>
                  <TableCell>{m.verified ? "Yes" : "No"}</TableCell>
                  <TableCell>{formatSuperAdmin(m.superAdmin)}</TableCell>
                  <TableCell>
                    {orgs.length
                      ? orgs.map((o, i) => (
                          <span key={o.id}>
                            {i > 0 && ", "}
                            <Link href={`/admin/${o.id}`}>{o.name}</Link> (
                            {o.role})
                          </span>
                        ))
                      : "-"}
                  </TableCell>
                  <TableCell style={{ textAlign: "right" }}>
                    {canEdit && (
                      <Link
                        aria-label={`Edit ${m.name || m.email}`}
                        onClick={(e) => {
                          e.preventDefault();
                          setEditMember(m);
                        }}
                      >
                        <GBEdit />
                      </Link>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {data?.members.length === 0 && (
              <TableRow>
                <TableCell colSpan={8}>
                  <Text color="text-mid">No members found</Text>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Box>
      {data && data.total > 50 && (
        <Pagination
          currentPage={page}
          numItemsTotal={data.total}
          perPage={50}
          onPageChange={setPage}
        />
      )}
    </>
  );
}

export default function Admin() {
  const { license, superAdmin } = useUser();
  const canView = hasSuperAdminPermission(superAdmin, "view");

  if (!canView) {
    return (
      <Callout status="error">Only super admins can view this page</Callout>
    );
  }
  if (!isCloud() && license?.plan !== "enterprise") {
    return (
      <Callout status="error">
        You must be on an enterprise license to view this page
      </Callout>
    );
  }

  return (
    <Box className="pagecontents" p="3">
      <Heading as="h1" size="xl" mb="4">
        GrowthBook Admin
      </Heading>
      {!isCloud() && (
        <Frame>
          <ShowLicenseInfo showInput={false} />
        </Frame>
      )}
      <Tabs defaultValue="organizations" persistInURL={true}>
        <Box mb="4">
          <TabsList>
            <TabsTrigger value="organizations">Organizations</TabsTrigger>
            <TabsTrigger value="members">Members</TabsTrigger>
          </TabsList>
        </Box>
        <TabsContent value="organizations">
          <OrganizationList />
        </TabsContent>
        <TabsContent value="members">
          <MemberList />
        </TabsContent>
      </Tabs>
    </Box>
  );
}

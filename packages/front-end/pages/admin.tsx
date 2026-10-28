import { Dispatch, SetStateAction, useEffect, useState } from "react";
import { OrganizationInterface } from "shared/types/organization";
import { Box, Flex } from "@radix-ui/themes";
import { useRouter } from "next/router";
import { PiCaretRight, PiMagnifyingGlass } from "react-icons/pi";
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
import Badge from "@/ui/Badge";
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

type OrgFilters = {
  page: number;
  search: string;
  plan: string;
  status: string;
  members: string;
  createdDays: string;
  loginMethod: string;
};
const DEFAULT_ORG_FILTERS: OrgFilters = {
  page: 1,
  search: "",
  plan: "all",
  status: "all",
  members: "all",
  createdDays: "all",
  loginMethod: "all",
};

type MemberFilters = { page: number; search: string; superAdminsOnly: boolean };
const DEFAULT_MEMBER_FILTERS: MemberFilters = {
  page: 1,
  search: "",
  superAdminsOnly: false,
};

// Searches as you type; the delay keeps each keystroke from hitting the API
function useDebouncedSearch<T extends { search: string; page: number }>(
  search: string,
  setFilters: Dispatch<SetStateAction<T>>,
) {
  const [input, setInput] = useState(search);
  useEffect(() => {
    const timeout = setTimeout(() => {
      const next = input.trim();
      setFilters((f) =>
        f.search === next ? f : { ...f, search: next, page: 1 },
      );
    }, 300);
    return () => clearTimeout(timeout);
  }, [input, setFilters]);
  return [input, setInput] as const;
}

function OrganizationList({
  filters,
  setFilters,
}: {
  filters: OrgFilters;
  setFilters: Dispatch<SetStateAction<OrgFilters>>;
}) {
  const router = useRouter();
  const { superAdmin } = useUser();
  const { page, search, plan, status, members, createdDays, loginMethod } =
    filters;
  const [searchInput, setSearchInput] = useDebouncedSearch(search, setFilters);
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
  const filterSetter =
    (key: keyof Omit<OrgFilters, "page">) => (value: string) =>
      setFilters({ ...filters, [key]: value, page: 1 });

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
        <Box flexGrow="0" flexShrink="1" flexBasis="360px" minWidth="240px">
          <TextField
            type="search"
            aria-label="Search organizations"
            placeholder="Name, ID, domain, or owner email"
            prepend={<PiMagnifyingGlass aria-hidden />}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </Box>
        {isCloud() && (
          <Select value={plan} setValue={filterSetter("plan")}>
            <SelectItem value="all">All plans</SelectItem>
            <SelectItem value="starter">Starter</SelectItem>
            <SelectItem value="pro">Pro</SelectItem>
            <SelectItem value="enterprise">Enterprise</SelectItem>
          </Select>
        )}
        <Select value={status} setValue={filterSetter("status")}>
          <SelectItem value="all">All statuses</SelectItem>
          {isCloud() && <SelectItem value="trialing">Trial</SelectItem>}
          {isCloud() && <SelectItem value="past_due">Past due</SelectItem>}
          {isCloud() && <SelectItem value="canceled">Canceled</SelectItem>}
          <SelectItem value="suspended">Suspended</SelectItem>
          <SelectItem value="disabled">Disabled</SelectItem>
        </Select>
        <Select value={members} setValue={filterSetter("members")}>
          <SelectItem value="all">Any number of members</SelectItem>
          <SelectItem value="1-9">1–9 members</SelectItem>
          <SelectItem value="10-49">10–49 members</SelectItem>
          <SelectItem value="50+">50+ members</SelectItem>
        </Select>
        <Select value={createdDays} setValue={filterSetter("createdDays")}>
          <SelectItem value="all">Created any time</SelectItem>
          <SelectItem value="7">Created in the last 7 days</SelectItem>
          <SelectItem value="30">Created in the last 30 days</SelectItem>
          <SelectItem value="90">Created in the last 90 days</SelectItem>
          <SelectItem value="365">Created in the last year</SelectItem>
        </Select>
        {isCloud() && (
          <Select value={loginMethod} setValue={filterSetter("loginMethod")}>
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
              <TableColumnHeader />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.organizations.map((o) => {
              const summary = data.summaries[o.id];
              return (
                <TableRow
                  key={o.id}
                  onClick={(e) => {
                    // The caret link handles its own clicks, including Cmd/Ctrl-click
                    if ((e.target as HTMLElement).closest("a")) return;
                    router.push(`/admin/${o.id}`);
                  }}
                  style={{ whiteSpace: "nowrap", cursor: "pointer" }}
                >
                  <TableCell>
                    <Text weight="semibold">{o.name}</Text>
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
                  <TableCell style={{ textAlign: "right" }}>
                    <Link
                      href={`/admin/${o.id}`}
                      color="gray"
                      aria-label={`Open ${o.name}`}
                    >
                      <PiCaretRight />
                    </Link>
                  </TableCell>
                </TableRow>
              );
            })}
            {data?.organizations.length === 0 && (
              <TableRow>
                <TableCell colSpan={8}>
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
          onPageChange={(p) => setFilters({ ...filters, page: p })}
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

function MemberList({
  filters,
  setFilters,
}: {
  filters: MemberFilters;
  setFilters: Dispatch<SetStateAction<MemberFilters>>;
}) {
  const { superAdmin } = useUser();
  const canEdit =
    hasSuperAdminPermission(superAdmin, "users") ||
    hasSuperAdminPermission(superAdmin, "grant");
  const { page, search, superAdminsOnly } = filters;
  const [searchInput, setSearchInput] = useDebouncedSearch(search, setFilters);
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
        <Box flexGrow="0" flexShrink="1" flexBasis="360px" minWidth="240px">
          <TextField
            type="search"
            aria-label="Search members"
            placeholder="Name, email, or user ID"
            prepend={<PiMagnifyingGlass aria-hidden />}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
        </Box>
        <Checkbox
          id="super-admins-only"
          label="Super admins only"
          value={superAdminsOnly}
          setValue={(v) =>
            setFilters({ ...filters, superAdminsOnly: v, page: 1 })
          }
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
                  <TableCell>
                    <Badge
                      label={m.verified ? "Verified" : "Unverified"}
                      color={m.verified ? "green" : "amber"}
                    />
                  </TableCell>
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
          onPageChange={(p) => setFilters({ ...filters, page: p })}
        />
      )}
    </>
  );
}

export default function Admin() {
  const { license, superAdmin } = useUser();
  // Kept here so filters survive switching tabs, which unmounts each list
  const [orgFilters, setOrgFilters] = useState(DEFAULT_ORG_FILTERS);
  const [memberFilters, setMemberFilters] = useState(DEFAULT_MEMBER_FILTERS);
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
          <OrganizationList filters={orgFilters} setFilters={setOrgFilters} />
        </TabsContent>
        <TabsContent value="members">
          <MemberList filters={memberFilters} setFilters={setMemberFilters} />
        </TabsContent>
      </Tabs>
    </Box>
  );
}

import { Dispatch, SetStateAction, useEffect, useRef, useState } from "react";
import { OrganizationInterface } from "shared/types/organization";
import { Box, Flex } from "@radix-ui/themes";
import { useRouter } from "next/router";
import { PiCaretRight, PiMagnifyingGlass } from "react-icons/pi";
import { date } from "shared/dates";
import { hasSuperAdminPermission } from "shared/permissions";
import { AdminOrgSummary } from "shared/enterprise";
import { useUser } from "@/services/UserContext";
import OrphanedUsersList from "@/components/Settings/Team/OrphanedUsersList";
import { isCloud, isMultiOrg } from "@/services/env";
import LoadingOverlay from "@/components/LoadingOverlay";
import PageHead from "@/components/Layout/PageHead";
import CreateOrganization from "@/components/Admin/CreateOrganization";
import { AdminMember, formatSuperAdmin } from "@/components/Admin/EditMember";
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

const numberFormatter = new Intl.NumberFormat();

// For names, emails and IDs, which have few spaces to wrap at
const WRAP = { overflowWrap: "anywhere" } as const;

const MEMBER_RANGES: Record<
  string,
  { min?: number; max?: number; label: string }
> = {
  "1-3": { min: 1, max: 3, label: "1–3 members" },
  "4-10": { min: 4, max: 10, label: "4–10 members" },
  "11-30": { min: 11, max: 30, label: "11–30 members" },
  "31+": { min: 31, label: "31+ members" },
};

type FilterOptions = [value: string, label: string][];

// What each org filter offers besides "all"; URL values outside these are ignored
function getOrgFilterOptions() {
  const cloud = isCloud();
  const cloudStatuses: FilterOptions = [
    ["trialing", "Trial"],
    ["past_due", "Past due"],
    ["canceled", "Canceled"],
  ];
  const options: Partial<Record<keyof OrgFilters, FilterOptions>> = {
    plan: cloud
      ? [
          ["starter", "Starter"],
          ["pro", "Pro"],
          ["enterprise", "Enterprise"],
        ]
      : [],
    status: [
      ...(cloud ? cloudStatuses : []),
      ["suspended", "Suspended"],
      ["disabled", "Disabled"],
      ["has_banner", "Has banner"],
    ],
    members: Object.entries(MEMBER_RANGES).map(([value, r]) => [
      value,
      r.label,
    ]),
    createdDays: [
      ["7", "Created in the last 7 days"],
      ["30", "Created in the last 30 days"],
      ["90", "Created in the last 90 days"],
      ["365", "Created in the last year"],
    ],
    loginMethod: cloud
      ? [
          ["sso", "SSO"],
          ["sso_required", "SSO required"],
          ["none", "No SSO"],
        ]
      : [],
  };
  return options;
}

function optionItems(options: FilterOptions = []) {
  return options.map(([value, label]) => (
    <SelectItem key={value} value={value}>
      {label}
    </SelectItem>
  ));
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

// Kept in the URL so filters survive opening an organization and going back
function useQueryFilters<T extends Record<string, string | number | boolean>>(
  defaults: T,
  prefix = "",
  options: Partial<Record<keyof T, FilterOptions>> = {},
): [T, Dispatch<SetStateAction<T>>] {
  const router = useRouter();
  const filters = { ...defaults };
  for (const key of Object.keys(defaults) as (keyof T & string)[]) {
    const raw = router.query[prefix + key];
    if (typeof raw !== "string") continue;
    // A stale or hand-edited link can't set a value no control offers
    const allowed = options[key];
    if (allowed && !allowed.some(([value]) => value === raw)) continue;
    const fallback = defaults[key];
    filters[key] = (
      typeof fallback === "number"
        ? parseInt(raw) > 0
          ? parseInt(raw)
          : fallback
        : typeof fallback === "boolean"
          ? raw === "1"
          : raw
    ) as T[keyof T & string];
  }

  const setFilters: Dispatch<SetStateAction<T>> = (action) => {
    const next = typeof action === "function" ? action(filters) : action;
    if (next === filters) return;
    const query = { ...router.query };
    for (const key of Object.keys(defaults)) {
      delete query[prefix + key];
      if (next[key] !== defaults[key]) {
        query[prefix + key] = next[key] === true ? "1" : String(next[key]);
      }
    }
    router.replace(
      { pathname: router.pathname, query, hash: window.location.hash },
      undefined,
      { shallow: true },
    );
  };
  return [filters, setFilters];
}

// Searches as you type; the delay keeps each keystroke from hitting the API
function useDebouncedSearch<T extends { search: string; page: number }>(
  search: string,
  setFilters: Dispatch<SetStateAction<T>>,
) {
  const [input, setInput] = useState(search);
  // The last search this input wrote, to tell it apart from URL changes made
  // elsewhere, like the Admin nav link clearing the search
  const written = useRef(search);
  useEffect(() => {
    if (search !== written.current) {
      written.current = search;
      setInput(search);
    }
  }, [search]);
  useEffect(() => {
    const timeout = setTimeout(() => {
      const next = input.trim();
      written.current = next;
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
  const options = getOrgFilterOptions();

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
          <Select
            aria-label="Plan"
            value={plan}
            setValue={filterSetter("plan")}
          >
            <SelectItem value="all">All plans</SelectItem>
            {optionItems(options.plan)}
          </Select>
        )}
        <Select
          aria-label="Status"
          value={status}
          setValue={filterSetter("status")}
        >
          <SelectItem value="all">All statuses</SelectItem>
          {optionItems(options.status)}
        </Select>
        <Select
          aria-label="Members"
          value={members}
          setValue={filterSetter("members")}
        >
          <SelectItem value="all">Any number of members</SelectItem>
          {optionItems(options.members)}
        </Select>
        <Select
          aria-label="Created"
          value={createdDays}
          setValue={filterSetter("createdDays")}
        >
          <SelectItem value="all">Created any time</SelectItem>
          {optionItems(options.createdDays)}
        </Select>
        {isCloud() && (
          <Select
            aria-label="Login method"
            value={loginMethod}
            setValue={filterSetter("loginMethod")}
          >
            <SelectItem value="all">Any login method</SelectItem>
            {optionItems(options.loginMethod)}
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
                    router.push(`/admin/org/${o.id}`);
                  }}
                  style={{ cursor: "pointer" }}
                >
                  <TableCell maxWidth="280px" style={WRAP}>
                    <Text weight="semibold">{o.name}</Text>
                  </TableCell>
                  <TableCell style={WRAP}>
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
                  <TableCell maxWidth="280px" style={WRAP}>
                    {o.ownerEmail}
                  </TableCell>
                  {!isCloud() && (
                    <TableCell style={WRAP}>{o.externalId}</TableCell>
                  )}
                  <TableCell style={{ textAlign: "right" }}>
                    <Link
                      href={`/admin/org/${o.id}`}
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
  const router = useRouter();
  const { page, search, superAdminsOnly } = filters;
  const [searchInput, setSearchInput] = useDebouncedSearch(search, setFilters);

  const params = new URLSearchParams({ page: String(page), search });
  if (superAdminsOnly) params.set("superAdmins", "1");

  const { data, error } = useApi<{
    members: AdminMember[];
    total: number;
  }>(`/admin/members?${params.toString()}`);

  return (
    <>
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
              <TableColumnHeader>Created</TableColumnHeader>
              <TableColumnHeader>Verified</TableColumnHeader>
              <TableColumnHeader>Super admin</TableColumnHeader>
              <TableColumnHeader />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data?.members.map((m) => (
              <TableRow
                key={m.id}
                onClick={(e) => {
                  // The caret link handles its own clicks, including Cmd/Ctrl-click
                  if ((e.target as HTMLElement).closest("a")) return;
                  router.push(`/admin/user/${m.id}`);
                }}
                style={{ cursor: "pointer" }}
              >
                <TableCell maxWidth="200px" style={WRAP}>
                  {m.name}
                </TableCell>
                <TableCell maxWidth="300px" style={WRAP}>
                  {m.email}
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
                <TableCell maxWidth="200px" style={WRAP}>
                  {formatSuperAdmin(m.superAdmin)}
                </TableCell>
                <TableCell style={{ textAlign: "right" }}>
                  <Link
                    href={`/admin/user/${m.id}`}
                    color="gray"
                    aria-label={`Open ${m.name || m.email}`}
                  >
                    <PiCaretRight />
                  </Link>
                </TableCell>
              </TableRow>
            ))}
            {data?.members.length === 0 && (
              <TableRow>
                <TableCell colSpan={6}>
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
  const router = useRouter();
  const { license, superAdmin } = useUser();
  const [orgFilters, setOrgFilters] = useQueryFilters(
    DEFAULT_ORG_FILTERS,
    "",
    getOrgFilterOptions(),
  );
  const [memberFilters, setMemberFilters] = useQueryFilters(
    DEFAULT_MEMBER_FILTERS,
    "members.",
  );
  const canView = hasSuperAdminPermission(superAdmin, "view");

  // The search inputs read their starting value once, so wait for the query
  if (!router.isReady) {
    return <LoadingOverlay />;
  }
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
      <PageHead breadcrumb={[{ display: "Admin" }]} />
      <Heading as="h1" size="xl" mb="4">
        GrowthBook Admin
      </Heading>
      <Tabs
        defaultValue={isCloud() ? "organizations" : "license"}
        persistInURL={true}
      >
        <Box mb="4">
          <TabsList>
            {!isCloud() && <TabsTrigger value="license">License</TabsTrigger>}
            <TabsTrigger value="organizations">Organizations</TabsTrigger>
            <TabsTrigger value="members">Members</TabsTrigger>
          </TabsList>
        </Box>
        {!isCloud() && (
          <TabsContent value="license">
            <Frame>
              <ShowLicenseInfo showInput={false} />
            </Frame>
          </TabsContent>
        )}
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

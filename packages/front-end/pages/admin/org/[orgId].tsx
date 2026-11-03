import { ReactNode, useState } from "react";
import { useRouter } from "next/router";
import { Box, Flex, Grid } from "@radix-ui/themes";
import stringify from "json-stringify-pretty-compact";
import {
  OrganizationInterface,
  OrganizationMessage,
} from "shared/types/organization";
import { UserInterface } from "shared/types/user";
import { SSOConnectionInterface } from "shared/types/sso-connection";
import { DataSourceInterface } from "shared/types/datasource";
import { SuperAdminPermission } from "shared/validators";
import { getDefaultRole, hasSuperAdminPermission } from "shared/permissions";
import {
  AdminOrgSummary,
  getAdminOrgSummary,
  LicenseInterface,
} from "shared/enterprise";
import { DEFAULT_STATS_ENGINE } from "shared/constants";
import { date } from "shared/dates";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import { useUser } from "@/services/UserContext";
import { isCloud } from "@/services/env";
import {
  DEFAULT_DATA_REGION,
  DataRegion,
  useDataRegionOptions,
} from "@/services/dataRegions";
import PageHead from "@/components/Layout/PageHead";
import LoadingOverlay from "@/components/LoadingOverlay";
import Markdown from "@/components/Markdown/Markdown";
import Code from "@/components/SyntaxHighlighting/Code";
import { GBEdit } from "@/components/Icons";
import CopyableCode from "@/components/Settings/CopyableCode";
import EditOrganization from "@/components/Admin/EditOrganization";
import EditMember, { AdminMember } from "@/components/Admin/EditMember";
import EditSSOModal from "@/components/Admin/EditSSOModal";
import BannerModal from "@/components/Admin/BannerModal";
import KeyValues from "@/components/Admin/KeyValues";
import { PlanBadge, StatusBadge } from "@/components/Admin/OrgBadges";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import ConfirmDialog from "@/ui/ConfirmDialog";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Link from "@/ui/Link";
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
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";

type OrgDetailResponse = {
  organization: OrganizationInterface;
  summary: AdminOrgSummary;
  ssoConnection: SSOConnectionInterface | null;
  datasources: Pick<DataSourceInterface, "id" | "name" | "type">[];
  counts: {
    projects: number;
    features: number;
    experiments: number;
    sdkConnections: number;
    savedGroups: number;
  };
};

type DangerAction = "suspend" | "unsuspend" | "disable" | "enable";

const BANNER_LEVELS: Record<
  OrganizationMessage["level"],
  { label: string; color: "blue" | "amber" | "red" }
> = {
  info: { label: "Info", color: "blue" },
  warning: { label: "Warning", color: "amber" },
  danger: { label: "Danger", color: "red" },
};

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

const onOff = (value: boolean | undefined) => (value ? "On" : "Off");

export default function AdminOrganizationPage() {
  const router = useRouter();
  const orgId = router.query.orgId as string | undefined;
  const { superAdmin, license } = useUser();
  const canView = hasSuperAdminPermission(superAdmin, "view");

  const { data, error, mutate } = useApi<OrgDetailResponse>(
    `/admin/organization/${orgId}`,
    { shouldRun: () => canView && !!orgId },
  );

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
  if (error) {
    return <Callout status="error">{error.message}</Callout>;
  }
  if (!data) {
    return <LoadingOverlay />;
  }

  // Keyed so open forms reset if history jumps to another cached organization
  return (
    <OrganizationDetail key={data.organization.id} {...data} mutate={mutate} />
  );
}

function OrganizationDetail({
  organization: org,
  summary: cachedSummary,
  ssoConnection,
  datasources,
  counts,
  mutate,
}: OrgDetailResponse & { mutate: () => Promise<unknown> }) {
  const router = useRouter();
  const { superAdmin, userId } = useUser();
  const { orgId: currentOrgId, setOrgId, setSpecialOrg, apiCall } = useAuth();
  const dataRegionOptions = useDataRegionOptions();
  const can = (p: SuperAdminPermission) =>
    hasSuperAdminPermission(superAdmin, p);
  const isCurrent = org.id === currentOrgId;
  const canEditOrg = (
    ["metadata", "billing", "provision", "sso"] as const
  ).some(can);
  // Warehouse actions run inside the org, so they also need a way in
  const canProvision =
    can("provision") &&
    (can("impersonate") || org.members.some((m) => m.id === userId));
  const managedWarehouse = datasources.find(
    (ds) => ds.type === "growthbook_clickhouse",
  );

  const {
    data: membersData,
    error: membersError,
    mutate: mutateMembers,
  } = useApi<{
    members: UserInterface[];
  }>(`/admin/organization/${org.id}/members`);
  const { data: licenseData, error: licenseError } = useApi<{
    license: LicenseInterface | null;
  }>(`/admin/organization/${org.id}/license`, {
    shouldRun: () => isCloud() && !!org.licenseKey,
  });
  const license = licenseData?.license ?? null;
  // The cached summary covers loading and license server errors
  const summary = license ? getAdminOrgSummary(org, license) : cachedSummary;

  const [memberSearch, setMemberSearch] = useState("");
  const [editOrgOpen, setEditOrgOpen] = useState(false);
  const [editSSOOpen, setEditSSOOpen] = useState(false);
  const [rawOpen, setRawOpen] = useState(false);
  const [bannerIndex, setBannerIndex] = useState<number | "new" | null>(null);
  const [editMember, setEditMember] = useState<AdminMember | null>(null);
  const [dangerAction, setDangerAction] = useState<DangerAction | null>(null);
  const [warehouseOpen, setWarehouseOpen] = useState(false);
  const [removeBannerIndex, setRemoveBannerIndex] = useState<number | null>(
    null,
  );
  const [recreateOpen, setRecreateOpen] = useState(false);
  const [region, setRegion] = useState<DataRegion>(DEFAULT_DATA_REGION);

  const users = new Map((membersData?.members ?? []).map((u) => [u.id, u]));
  const members: AdminMember[] = org.members.map((m) => {
    const user = users.get(m.id);
    return {
      ...m,
      name: user?.name ?? "",
      email: user?.email ?? "",
      verified: !!user?.verified,
      superAdmin: user?.superAdmin ?? false,
      authSubject: user?.authSubject,
    };
  });
  const search = memberSearch.trim().toLowerCase();
  const filteredMembers = search
    ? members.filter((m) =>
        `${m.name} ${m.email}`.toLowerCase().includes(search),
      )
    : members;

  const messages = org.messages ?? [];
  const settings = org.settings ?? {};
  const schedule = settings.updateSchedule;
  const requireReviews = settings.requireReviews;
  // Shown in two columns of five
  const usage = (
    [
      ["Projects", counts.projects],
      ["Feature Flags", counts.features],
      ["Experiments", counts.experiments],
      ["SDK Connections", counts.sdkConnections],
      ["Data Sources", datasources.length],
      ["Namespaces", settings.namespaces?.length ?? 0],
      ["Saved Groups", counts.savedGroups],
      ["Custom roles", org.customRoles?.length ?? 0],
      ["North Star metrics", settings.northStar?.metricIds?.length ?? 0],
      ["Attributes", settings.attributeSchema?.length ?? 0],
    ] as const
  ).map(([label, value]) => ({ label, value: value.toLocaleString() }));

  const logIn = () => {
    setOrgId?.(org.id);
    try {
      localStorage.setItem("gb-last-picked-org", `"${org.id}"`);
    } catch (e) {
      console.warn("Cannot set gb-last-picked-org");
    }
    setSpecialOrg?.(org);
    router.push("/");
  };

  const runDangerAction = async (action: DangerAction) => {
    if (action === "suspend" || action === "unsuspend") {
      await apiCall("/admin/organization", {
        method: "PUT",
        body: JSON.stringify({
          orgId: org.id,
          suspended: action === "suspend",
        }),
      });
    } else {
      await apiCall(`/admin/organization/${action}`, {
        method: "PUT",
        body: JSON.stringify({ orgId: org.id }),
      });
    }
    await mutate();
  };

  const editIcon = (label: string, onClick: () => void) => (
    <Link
      aria-label={label}
      onClick={(e) => {
        e.preventDefault();
        onClick();
      }}
    >
      <GBEdit />
    </Link>
  );

  const cardHeading = (title: string, action?: ReactNode) => (
    <Flex align="center" justify="between" mb="3">
      <Heading as="h2" size="md" mb="0">
        {title}
      </Heading>
      {action}
    </Flex>
  );

  return (
    <Box className="pagecontents" p="3">
      <PageHead
        breadcrumb={[
          { display: "Admin", href: "/admin" },
          { display: org.name },
        ]}
      />

      {editOrgOpen && (
        <EditOrganization
          id={org.id}
          currentOrg={org}
          onEdit={mutate}
          close={() => setEditOrgOpen(false)}
        />
      )}
      {editSSOOpen && (
        <EditSSOModal
          close={() => setEditSSOOpen(false)}
          organizationId={org.id}
          organizationName={org.name}
          currentSSO={ssoConnection ?? undefined}
          enforced={
            !!org.restrictLoginMethod &&
            org.restrictLoginMethod === ssoConnection?.id
          }
          onSave={mutate}
        />
      )}
      {bannerIndex !== null && (
        <BannerModal
          orgId={org.id}
          orgName={org.name}
          messages={messages}
          index={bannerIndex === "new" ? null : bannerIndex}
          close={() => setBannerIndex(null)}
          onSave={mutate}
        />
      )}
      {editMember && (
        <EditMember
          member={editMember}
          onEdit={mutateMembers}
          close={() => setEditMember(null)}
        />
      )}
      {dangerAction && (
        <ConfirmDialog
          title={
            {
              suspend: "Suspend Organization",
              unsuspend: "Unsuspend Organization",
              disable: "Disable Organization",
              enable: "Enable Organization",
            }[dangerAction]
          }
          content={
            {
              suspend: `Members of ${org.name} won't be able to use the app or API until it's unsuspended.`,
              unsuspend: `Members of ${org.name} will regain access.`,
              disable: `Members of ${org.name} will lose access, and its SSO connections will be disabled.`,
              enable: `Members of ${org.name} will regain access, and its SSO connections will be re-enabled.`,
            }[dangerAction]
          }
          yesText={
            {
              suspend: "Suspend",
              unsuspend: "Unsuspend",
              disable: "Disable",
              enable: "Enable",
            }[dangerAction]
          }
          color={
            dangerAction === "suspend" || dangerAction === "disable"
              ? "red"
              : "violet"
          }
          onConfirm={async () => {
            await runDangerAction(dangerAction);
            setDangerAction(null);
          }}
          onCancel={() => setDangerAction(null)}
        />
      )}
      {removeBannerIndex !== null && (
        <ConfirmDialog
          title="Remove Banner"
          content="Members will stop seeing this banner."
          yesText="Remove"
          color="red"
          onConfirm={async () => {
            await apiCall("/admin/organization", {
              method: "PUT",
              body: JSON.stringify({
                orgId: org.id,
                messages: messages.filter((_, i) => i !== removeBannerIndex),
              }),
            });
            await mutate();
            setRemoveBannerIndex(null);
          }}
          onCancel={() => setRemoveBannerIndex(null)}
        />
      )}
      {warehouseOpen && (
        <ModalStandard
          open
          trackingEventModalType=""
          header="Create Managed Warehouse"
          cta="Create"
          close={() => setWarehouseOpen(false)}
          submit={async () => {
            await apiCall(`/datasources/managed-warehouse`, {
              method: "POST",
              headers: { "X-Organization": org.id },
              body: JSON.stringify({ region }),
            });
            await mutate();
          }}
        >
          <Select
            label="Data region"
            value={region}
            setValue={(v) => setRegion(v as DataRegion)}
          >
            {dataRegionOptions.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </Select>
          <Text as="p" color="text-mid" mt="2">
            This can&apos;t be changed later.
          </Text>
        </ModalStandard>
      )}
      {recreateOpen && managedWarehouse && (
        <ConfirmDialog
          title="Drop and Recreate Managed Warehouse"
          content="This may take several minutes, and all queries will fail in the meantime."
          yesText="Drop and recreate"
          color="red"
          onConfirm={async () => {
            await apiCall(
              `/datasource/${managedWarehouse.id}/recreate-managed-warehouse`,
              {
                method: "POST",
                headers: { "X-Organization": org.id },
              },
            );
            setRecreateOpen(false);
          }}
          onCancel={() => setRecreateOpen(false)}
        />
      )}
      {rawOpen && (
        <ModalStandard
          open
          trackingEventModalType=""
          header="Raw JSON"
          size="xl"
          close={() => setRawOpen(false)}
          closeCta="Close"
        >
          <Flex direction="column" gap="4">
            <Code
              language="json"
              filename="Organization"
              code={stringify({ ...org, settings: undefined })}
            />
            <Code
              language="json"
              filename="Settings"
              code={stringify(settings)}
            />
            {license && (
              <Code
                language="json"
                filename="License"
                code={stringify(license)}
              />
            )}
          </Flex>
        </ModalStandard>
      )}

      <Flex justify="between" align="start" gap="4" wrap="wrap" mb="4">
        <Flex direction="column" gap="1" minWidth="0">
          <Flex align="center" gap="3" wrap="wrap">
            <Heading as="h1" size="xl" mb="0" overflowWrap="anywhere">
              {org.name}
            </Heading>
            {isCloud() && (
              <PlanBadge plan={summary.plan} legacy={org.enterprise} />
            )}
            <StatusBadge status={summary.status} />
          </Flex>
          <Flex gap="4" wrap="wrap" align="center">
            <CopyableCode value={org.id} muted />
            {org.verifiedDomain && (
              <Text color="text-mid" size="sm">
                {org.verifiedDomain}
              </Text>
            )}
            <Text color="text-mid" size="sm">
              Created {date(org.dateCreated)}
            </Text>
          </Flex>
        </Flex>
        <Flex gap="2">
          {can("messages") && (
            <Button variant="outline" onClick={() => setBannerIndex("new")}>
              Add banner
            </Button>
          )}
          {can("impersonate") && (
            <Button onClick={logIn}>Log in as this organization</Button>
          )}
        </Flex>
      </Flex>

      {summary.status === "past_due" && (
        <Callout status="error" mb="3">
          This organization&apos;s subscription is past due.
        </Callout>
      )}

      {messages.map((m, i) => (
        <Frame key={i} py="3" px="4" mb="3">
          <Flex align="center" gap="3">
            <Badge
              label={`Banner · ${BANNER_LEVELS[m.level].label}`}
              color={BANNER_LEVELS[m.level].color}
            />
            <Box flexGrow="1" minWidth="0">
              <Markdown>{m.message}</Markdown>
            </Box>
            {can("messages") && (
              <Flex gap="2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setBannerIndex(i)}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setRemoveBannerIndex(i)}
                >
                  Remove
                </Button>
              </Flex>
            )}
          </Flex>
        </Frame>
      ))}

      <Flex gap="4" wrap="wrap" align="start">
        <Flex direction="column" flexGrow="999" flexBasis="640px" minWidth="0">
          <Frame px="0" pt="4" pb="0">
            <Flex align="center" gap="3" px="5" mb="3" wrap="wrap">
              <Heading as="h2" size="md" mb="0">
                Members
              </Heading>
              <Text color="text-mid">
                {plural(org.members.length, "member")},{" "}
                {plural(org.invites.length, "pending invite")}
              </Text>
              <Box ml="auto">
                <TextField
                  size="sm"
                  type="search"
                  placeholder="Search members"
                  aria-label="Search members"
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                />
              </Box>
            </Flex>
            <Table variant="list" stickyHeader scrollX maxHeight="400px">
              <TableHeader>
                <TableRow>
                  <TableColumnHeader>Name</TableColumnHeader>
                  <TableColumnHeader>Email</TableColumnHeader>
                  <TableColumnHeader>Role</TableColumnHeader>
                  <TableColumnHeader>Last login</TableColumnHeader>
                  <TableColumnHeader>Verified</TableColumnHeader>
                  <TableColumnHeader />
                </TableRow>
              </TableHeader>
              <TableBody>
                {!membersData ? (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <Text color="text-mid">
                        {membersError
                          ? `Couldn't load members: ${membersError.message}`
                          : "Loading members..."}
                      </Text>
                    </TableCell>
                  </TableRow>
                ) : filteredMembers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <Text color="text-mid">
                        {memberSearch
                          ? `No members match "${memberSearch}"`
                          : "No members"}
                      </Text>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredMembers.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell style={{ overflowWrap: "anywhere" }}>
                        <Link href={`/admin/user/${m.id}`}>
                          {m.name || "-"}
                        </Link>
                      </TableCell>
                      <TableCell style={{ overflowWrap: "anywhere" }}>
                        {m.email || "-"}
                      </TableCell>
                      <TableCell>{m.role}</TableCell>
                      <TableCell>
                        {m.lastLoginDate ? date(m.lastLoginDate) : "-"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          label={m.verified ? "Verified" : "Unverified"}
                          color={m.verified ? "green" : "amber"}
                        />
                      </TableCell>
                      <TableCell style={{ textAlign: "right" }}>
                        {(can("users") || can("grant")) &&
                          editIcon(`Edit ${m.name || m.email}`, () =>
                            setEditMember(m),
                          )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Frame>

          <Frame py="4" px="5">
            {cardHeading("Usage")}
            <Grid columns={{ initial: "1", md: "2" }} gapX="6" gapY="2">
              <KeyValues items={usage.slice(0, 5)} />
              <KeyValues items={usage.slice(5)} />
            </Grid>
          </Frame>

          <Frame py="4" px="5">
            {cardHeading(
              "Settings",
              <Button
                size="sm"
                variant="outline"
                onClick={() => setRawOpen(true)}
              >
                View raw JSON
              </Button>,
            )}
            <Grid columns={{ initial: "1", md: "2" }} gapX="6" gapY="2">
              <KeyValues
                items={[
                  {
                    label: "Stats engine",
                    value:
                      (settings.statsEngine ?? DEFAULT_STATS_ENGINE) ===
                      "frequentist"
                        ? "Frequentist"
                        : "Bayesian",
                  },
                  {
                    label: "Update schedule",
                    value: !schedule
                      ? "Default"
                      : schedule.type === "never"
                        ? "Never"
                        : schedule.type === "cron"
                          ? `Cron: ${schedule.cron}`
                          : `Every ${schedule.hours} hours`,
                  },
                  {
                    label: "Sticky bucketing",
                    value: onOff(settings.useStickyBucketing),
                  },
                  {
                    label: "AI enabled",
                    value: settings.aiEnabled ? "Yes" : "No",
                  },
                ]}
              />
              <KeyValues
                items={[
                  {
                    label: "Environments",
                    value:
                      settings.environments?.map((e) => e.id).join(", ") ||
                      "None",
                  },
                  {
                    label: "Approvals",
                    value: onOff(
                      Array.isArray(requireReviews)
                        ? requireReviews.some((r) => r.requireReviewOn)
                        : requireReviews,
                    ),
                  },
                  {
                    label: "Code references",
                    value: onOff(settings.codeReferencesEnabled),
                  },
                  { label: "Default role", value: getDefaultRole(org).role },
                ]}
              />
            </Grid>
          </Frame>
        </Flex>

        <Flex direction="column" flexGrow="1" flexBasis="360px" minWidth="0">
          <Frame py="4" px="5">
            {cardHeading(
              "Account",
              canEditOrg &&
                editIcon("Edit organization", () => setEditOrgOpen(true)),
            )}
            {licenseError && (
              <Callout status="error" mb="3">
                Plan, status and seats are from the cached license.
                Couldn&apos;t load the live one: {licenseError.message}
              </Callout>
            )}
            <KeyValues
              items={[
                { label: "Owner", value: org.ownerEmail },
                ...(isCloud()
                  ? [
                      {
                        label: "Plan",
                        value: (
                          <PlanBadge
                            plan={summary.plan}
                            legacy={org.enterprise}
                          />
                        ),
                      },
                      {
                        label: "License key",
                        value: org.licenseKey ? (
                          <code>{org.licenseKey}</code>
                        ) : (
                          "None"
                        ),
                      },
                      {
                        label: "Expires",
                        value: license?.dateExpires
                          ? date(license.dateExpires)
                          : !org.licenseKey || licenseData
                            ? "-"
                            : licenseError
                              ? "Unavailable"
                              : "Loading...",
                      },
                      {
                        label: "Seats",
                        value: summary.seats
                          ? `${org.members.length} of ${summary.seats} used`
                          : org.enterprise
                            ? "Unlimited"
                            : `${org.members.length} of ${org.freeSeats ?? 3} free seats used`,
                      },
                      {
                        label: "Self-serve billing",
                        value: onOff(!org.disableSelfServeBilling),
                      },
                    ]
                  : [
                      { label: "External ID", value: org.externalId || "None" },
                    ]),
              ]}
            />
          </Frame>

          <Frame py="4" px="5">
            {cardHeading(
              "Login and SSO",
              isCloud() &&
                can("sso") &&
                editIcon("Edit SSO connection", () => setEditSSOOpen(true)),
            )}
            <KeyValues
              items={[
                ...(isCloud()
                  ? [
                      {
                        label: "SSO",
                        value: ssoConnection
                          ? `${ssoConnection.idpType ?? "OIDC"} · ${ssoConnection.id}${
                              ssoConnection.disabled ? " (disabled)" : ""
                            }`
                          : "None",
                      },
                      {
                        label: "Required",
                        value: !org.restrictLoginMethod
                          ? "No"
                          : org.restrictLoginMethod === ssoConnection?.id
                            ? "Yes"
                            : `Yes, via ${org.restrictLoginMethod}`,
                      },
                      {
                        label: "Email domains",
                        value:
                          ssoConnection?.emailDomains?.join(", ") || "None",
                      },
                    ]
                  : []),
                {
                  label: "Verified domain",
                  value: org.verifiedDomain || "None",
                },
                { label: "Auto-join", value: onOff(org.autoApproveMembers) },
              ]}
            />
          </Frame>

          <Frame py="4" px="5">
            {cardHeading("Data")}
            <KeyValues
              items={[
                {
                  label: "Data Sources",
                  value: datasources.map((d) => d.name).join(", ") || "None",
                },
                ...(isCloud()
                  ? [
                      {
                        label: "Managed Warehouse",
                        value: managedWarehouse
                          ? "Provisioned"
                          : "Not provisioned",
                      },
                    ]
                  : []),
              ]}
            />
            {isCloud() && canProvision && (
              <Box mt="3">
                {managedWarehouse ? (
                  <Button
                    size="sm"
                    variant="outline"
                    color="red"
                    onClick={() => setRecreateOpen(true)}
                  >
                    Drop and recreate Managed Warehouse
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setWarehouseOpen(true)}
                  >
                    Provision Managed Warehouse
                  </Button>
                )}
              </Box>
            )}
          </Frame>

          {can("suspend") && (
            <Frame py="4" px="5">
              {cardHeading("Danger Zone")}
              <Flex direction="column" gap="3">
                <Flex align="center" justify="between" gap="3">
                  <Flex direction="column">
                    <Text>
                      {org.suspended ? "Unsuspend" : "Suspend"} organization
                    </Text>
                    {isCurrent ? (
                      <Text size="sm" color="text-mid">
                        Switch to another organization first.
                      </Text>
                    ) : org.disabled ? (
                      <Text size="sm" color="text-mid">
                        Enable this organization first.
                      </Text>
                    ) : null}
                  </Flex>
                  <Button
                    size="sm"
                    variant="outline"
                    color={org.suspended ? "violet" : "red"}
                    disabled={isCurrent || !!org.disabled}
                    onClick={() =>
                      setDangerAction(org.suspended ? "unsuspend" : "suspend")
                    }
                  >
                    {org.suspended ? "Unsuspend" : "Suspend"}
                  </Button>
                </Flex>
                <Flex align="center" justify="between" gap="3">
                  <Flex direction="column">
                    <Text>
                      {org.disabled ? "Enable" : "Disable"} organization
                    </Text>
                    {isCurrent && (
                      <Text size="sm" color="text-mid">
                        Switch to another organization first.
                      </Text>
                    )}
                  </Flex>
                  <Button
                    size="sm"
                    variant="outline"
                    color={org.disabled ? "violet" : "red"}
                    disabled={isCurrent}
                    onClick={() =>
                      setDangerAction(org.disabled ? "enable" : "disable")
                    }
                  >
                    {org.disabled ? "Enable" : "Disable"}
                  </Button>
                </Flex>
              </Flex>
            </Frame>
          )}
        </Flex>
      </Flex>
    </Box>
  );
}

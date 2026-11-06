import { useState } from "react";
import { Flex } from "@radix-ui/themes";
import { datetime } from "shared/dates";
import {
  MANAGED_WAREHOUSE_RECREATABLE_TABLES,
  ManagedWarehouseRecreatableTable,
} from "shared/util";
import type {
  ManagedWarehouseRecreateRequest,
  ManagedWarehouseRecreateStatus,
} from "shared/validators";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import Checkbox from "@/ui/Checkbox";
import ConfirmDialog from "@/ui/ConfirmDialog";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import HelperText from "@/ui/HelperText";
import Link from "@/ui/Link";
import RadioGroup from "@/ui/RadioGroup";
import Table, {
  TableBody,
  TableCell,
  TableColumnHeader,
  TableHeader,
  TableRow,
} from "@/ui/Table";
import Text from "@/ui/Text";
import TextField from "@/ui/TextField";

// Poll while a recreate is queued or running; each one takes minutes.
const POLL_INTERVAL_MS = 15000;

const STATUSES = {
  pending: { label: "Pending", color: "gray" },
  running: { label: "Running", color: "blue" },
  done: { label: "Done", color: "green" },
  failed: { label: "Failed", color: "red" },
} as const;

export const isRecreateActive = (
  status: ManagedWarehouseRecreateStatus | undefined,
) => status === "pending" || status === "running";

function RecreateStatusBadge({
  status,
  count,
}: {
  status: ManagedWarehouseRecreateStatus;
  count?: number;
}) {
  const { label, color } = STATUSES[status];
  return (
    <Badge
      label={count === undefined ? label : `${label}: ${count}`}
      color={color}
    />
  );
}

/** One checkbox per Managed Warehouse table that can be recreated. */
export function RecreateTablesCheckboxes({
  value,
  setValue,
}: {
  value: ManagedWarehouseRecreatableTable[];
  setValue: (value: ManagedWarehouseRecreatableTable[]) => void;
}) {
  return (
    <Flex direction="column" gap="2">
      {MANAGED_WAREHOUSE_RECREATABLE_TABLES.map((table) => (
        <Checkbox
          key={table}
          label={<Text mono>{table}</Text>}
          value={value.includes(table)}
          setValue={(checked) =>
            setValue(
              MANAGED_WAREHOUSE_RECREATABLE_TABLES.filter((t) =>
                t === table ? checked : value.includes(t),
              ),
            )
          }
        />
      ))}
    </Flex>
  );
}

/** The org's latest recreate request, polled while it's queued or running. */
export function useManagedWarehouseRecreateRequest(orgId: string) {
  const { data, mutate } = useApi<{
    request: ManagedWarehouseRecreateRequest | null;
  }>(`/admin/organization/${orgId}/managed-warehouse/recreate`, {
    refreshInterval: (latest) =>
      isRecreateActive(latest?.request?.status) ? POLL_INTERVAL_MS : 0,
  });
  return { request: data?.request ?? null, mutate };
}

export function RecreateRequestSummary({
  request,
}: {
  request: ManagedWarehouseRecreateRequest;
}) {
  return (
    <Flex direction="column" gap="1">
      <Flex align="center" gap="2">
        <Text size="sm">Last recreate:</Text>
        <RecreateStatusBadge status={request.status} />
      </Flex>
      <Text size="sm" color="text-mid">
        <Text mono>{request.tables.join(", ")}</Text> · requested{" "}
        {datetime(request.requestedAt)}
        {request.finishedAt
          ? ` · finished ${datetime(request.finishedAt)}`
          : ""}
      </Text>
      {request.error && (
        <HelperText status="error" size="sm">
          {request.error}
        </HelperText>
      )}
    </Flex>
  );
}

type RecreatesResponse = {
  counts: Record<ManagedWarehouseRecreateStatus, number>;
  requests: {
    organization: string;
    request: ManagedWarehouseRecreateRequest;
  }[];
};

/** Super-admin panel for recreating Managed Warehouse tables across orgs. */
export default function ManagedWarehouseRecreates({
  canRequest,
}: {
  canRequest: boolean;
}) {
  const { apiCall } = useAuth();
  const { data, error, mutate } = useApi<RecreatesResponse>(
    "/admin/managed-warehouse/recreates",
    {
      refreshInterval: (latest) =>
        latest && latest.counts.pending + latest.counts.running > 0
          ? POLL_INTERVAL_MS
          : 0,
    },
  );

  // Start with nothing checked so a bulk run is always a deliberate choice
  const [tables, setTables] = useState<ManagedWarehouseRecreatableTable[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [target, setTarget] = useState<"all" | "list">("list");
  const [orgIds, setOrgIds] = useState("");
  const [message, setMessage] = useState("");
  const [submitError, setSubmitError] = useState("");

  const organizations = orgIds
    .split(/[\s,]+/)
    .map((id) => id.trim())
    .filter(Boolean);

  const run = async (action: () => Promise<string>) => {
    setMessage("");
    setSubmitError("");
    try {
      setMessage(await action());
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e));
    }
    await mutate();
  };

  const request = () =>
    run(async () => {
      const { created } = await apiCall<{ created: number }>(
        "/admin/managed-warehouse/recreates",
        {
          method: "POST",
          body: JSON.stringify({
            tables,
            organizations: target === "all" ? "all" : organizations,
          }),
        },
      );
      return `Queued ${created} recreate${created === 1 ? "" : "s"}.`;
    });

  const counts = data?.counts;
  const targetDescription =
    target === "all"
      ? "every Managed Warehouse"
      : `${organizations.length} organization${organizations.length === 1 ? "" : "s"}`;

  return (
    <Flex direction="column" gap="4">
      {confirming && (
        <ConfirmDialog
          title="Recreate Derived Tables"
          content={
            <>
              Recreate <Text mono>{tables.join(", ")}</Text> for{" "}
              {targetDescription}? Two orgs run at a time, and pending recreates
              can be cancelled.
            </>
          }
          yesText="Queue recreates"
          onConfirm={async () => {
            setConfirming(false);
            await request();
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
      {confirmingCancel && (
        <ConfirmDialog
          title="Cancel Pending Recreates"
          content={`Cancel ${counts?.pending ?? 0} pending recreate${counts?.pending === 1 ? "" : "s"}? Running recreates aren't affected.`}
          yesText="Cancel pending"
          noText="Keep pending"
          color="red"
          onConfirm={async () => {
            setConfirmingCancel(false);
            await run(async () => {
              const { cancelled } = await apiCall<{ cancelled: number }>(
                "/admin/managed-warehouse/recreates/cancel-pending",
                { method: "POST" },
              );
              return `Cancelled ${cancelled} pending recreate${cancelled === 1 ? "" : "s"}.`;
            });
          }}
          onCancel={() => setConfirmingCancel(false)}
        />
      )}
      {canRequest && (
        <Frame py="4" px="5">
          <Heading as="h3" size="sm" mb="3">
            Recreate Derived Tables
          </Heading>
          <Text as="p" mb="3" color="text-mid">
            Each selected derived table is rebuilt and backfilled from raw
            events, two orgs at a time. Queries keep working while it runs. Orgs
            whose warehouse hasn&apos;t been set up, or that are already running
            a recreate, are skipped.
          </Text>
          <Flex direction="column" gap="4">
            <Flex direction="column" gap="2">
              <Text weight="semibold">Tables</Text>
              <RecreateTablesCheckboxes value={tables} setValue={setTables} />
            </Flex>
            <Flex direction="column" gap="2">
              <Text weight="semibold">Organizations</Text>
              <RadioGroup
                value={target}
                setValue={(v) => setTarget(v as "all" | "list")}
                options={[
                  { value: "list", label: "These organizations" },
                  { value: "all", label: "All Managed Warehouses" },
                ]}
              />
              {target === "list" && (
                <TextField
                  multiline
                  label="Organization IDs"
                  placeholder="org_abc123, org_def456"
                  value={orgIds}
                  onChange={(e) => setOrgIds(e.target.value)}
                />
              )}
            </Flex>
            <Flex>
              <Button
                disabled={
                  !tables.length || (target === "list" && !organizations.length)
                }
                onClick={() => setConfirming(true)}
              >
                Queue recreates
              </Button>
            </Flex>
          </Flex>
        </Frame>
      )}

      {message && <Callout status="success">{message}</Callout>}
      {submitError && <Callout status="error">{submitError}</Callout>}
      {error && <Callout status="error">{error.message}</Callout>}

      <Frame py="4" px="5">
        <Flex justify="between" align="center" mb="3">
          <Heading as="h3" size="sm">
            Progress
          </Heading>
          {canRequest && (
            <Flex gap="2">
              <Button
                size="sm"
                variant="outline"
                disabled={!counts?.failed}
                onClick={() =>
                  run(async () => {
                    const { retried } = await apiCall<{ retried: number }>(
                      "/admin/managed-warehouse/recreates/retry-failed",
                      { method: "POST" },
                    );
                    return `Requeued ${retried} failed recreate${retried === 1 ? "" : "s"}.`;
                  })
                }
              >
                Retry failed
              </Button>
              <Button
                size="sm"
                variant="outline"
                color="red"
                disabled={!counts?.pending}
                onClick={() => setConfirmingCancel(true)}
              >
                Cancel pending
              </Button>
            </Flex>
          )}
        </Flex>
        {counts && (
          <Flex gap="3" mb="3">
            {(Object.keys(STATUSES) as ManagedWarehouseRecreateStatus[]).map(
              (status) => (
                <RecreateStatusBadge
                  key={status}
                  status={status}
                  count={counts[status]}
                />
              ),
            )}
          </Flex>
        )}
        {!data && !error ? (
          <Text color="text-mid">Loading…</Text>
        ) : data && !data.requests.length ? (
          <Text color="text-mid">No recreates queued, running or failed.</Text>
        ) : (
          <Table variant="list" stickyHeader scrollX maxHeight="400px">
            <TableHeader>
              <TableRow>
                <TableColumnHeader>Organization</TableColumnHeader>
                <TableColumnHeader>Status</TableColumnHeader>
                <TableColumnHeader>Tables</TableColumnHeader>
                <TableColumnHeader>Requested</TableColumnHeader>
                <TableColumnHeader>Error</TableColumnHeader>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.requests ?? []).map(({ organization, request }) => (
                <TableRow key={organization}>
                  <TableCell>
                    <Link href={`/admin/org/${organization}`}>
                      <Text mono>{organization}</Text>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <RecreateStatusBadge status={request.status} />
                  </TableCell>
                  <TableCell>
                    <Text mono>{request.tables.join(", ")}</Text>
                  </TableCell>
                  <TableCell>{datetime(request.requestedAt)}</TableCell>
                  <TableCell style={{ maxWidth: 400 }}>
                    {request.error && (
                      <HelperText status="error" size="sm">
                        {request.error}
                      </HelperText>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Frame>
    </Flex>
  );
}

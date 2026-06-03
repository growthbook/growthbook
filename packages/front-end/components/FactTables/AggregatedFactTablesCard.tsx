import { useState } from "react";
import { FactTableInterface } from "shared/types/fact-table";
import { QueryStatus } from "shared/types/query";
import { dateOnly, timestamp } from "shared/dates";
import { Flex, IconButton } from "@radix-ui/themes";
import { BsThreeDotsVertical } from "react-icons/bs";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import Callout from "@/ui/Callout";
import Badge from "@/ui/Badge";
import Button from "@/ui/Button";
import { RadixColor } from "@/ui/HelperText";
import Tooltip from "@/components/Tooltip/Tooltip";
import RadioGroup from "@/ui/RadioGroup";
import Modal from "@/ui/Modal";
import AsyncQueriesModal from "@/components/Queries/AsyncQueriesModal";
import {
  DropdownMenu,
  DropdownMenuGroup,
  DropdownMenuItem,
} from "@/ui/DropdownMenu";
import { useUser } from "@/services/UserContext";
import { useAuth } from "@/services/auth";
import useApi from "@/hooks/useApi";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";

export interface Props {
  factTable: FactTableInterface;
}

type RefreshResponse = {
  queued: string[];
};

type AggregatedFactTableMaterializationStatus =
  | "running"
  | "error"
  | "pending"
  | "active";

type AggregatedFactTableStatus = {
  idType: string;
  status: AggregatedFactTableMaterializationStatus;
  tableFullName: string | null;
  firstEventDate: string | null;
  lastEventDate: string | null;
  lastMaxTimestamp: string | null;
  lastError: string | null;
  dateUpdated: string | null;
};

const materializationStatusDisplay: Record<
  AggregatedFactTableMaterializationStatus,
  { label: string; color: RadixColor }
> = {
  running: { label: "Running", color: "blue" },
  error: { label: "Error", color: "red" },
  pending: { label: "Not built yet", color: "gray" },
  active: { label: "Active", color: "green" },
};

type AggregatedFactTableRunSummary = {
  id: string;
  mode: "incremental" | "restate";
  status: QueryStatus;
  runStarted: string | null;
  dateCreated: string;
  finishedAt: string | null;
  error: string | null;
  queryIds: string[];
};

// Event dates are calendar dates (truncate to YYYY-MM-DD).
function formatDay(value: string | null): string {
  return value ? dateOnly(value) : "—";
}

// Timestamps keep the full YYYY-MM-DD HH:MM:SS.
function formatTimestamp(value: string | null): string {
  return value ? timestamp(value) : "—";
}

const runStatusColor: Record<QueryStatus, RadixColor> = {
  queued: "gray",
  running: "blue",
  succeeded: "green",
  "partially-succeeded": "amber",
  failed: "red",
};

function runStatusLabel(status: QueryStatus): string {
  return status === "partially-succeeded" ? "partial" : status;
}

function ManageRefreshModal({
  factTable,
  status,
  close,
}: {
  factTable: FactTableInterface;
  status: AggregatedFactTableStatus;
  close: () => void;
}) {
  const { apiCall } = useAuth();
  const [mode, setMode] = useState<"incremental" | "restate">("incremental");
  // The run whose queries are shown in the (non-inline) AsyncQueriesModal.
  const [viewQueriesRunId, setViewQueriesRunId] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const { data: runsData, mutate: mutateRuns } = useApi<{
    runs: AggregatedFactTableRunSummary[];
  }>(
    `/fact-tables/${factTable.id}/aggregated-tables/${encodeURIComponent(
      status.idType,
    )}/runs`,
  );

  const runs = runsData?.runs ?? [];
  const viewQueriesRun = runs.find((r) => r.id === viewQueriesRunId) ?? null;

  const run = async () => {
    setRunError(null);
    console.log(mode);
    const fullRestate = mode === "restate";
    try {
      await apiCall<RefreshResponse>(
        `/fact-tables/${factTable.id}/aggregated-tables/refresh`,
        {
          method: "POST",
          body: JSON.stringify({ idType: status.idType, fullRestate }),
        },
      );
      // Surface the newly-queued run in the history table.
      await mutateRuns();
    } catch (e) {
      setRunError(e instanceof Error ? e.message : String(e));
    }
  };

  const running = runs[0]?.status === "running";

  return (
    <>
      {viewQueriesRun && (
        <AsyncQueriesModal
          queries={viewQueriesRun.queryIds}
          savedQueries={[]}
          error={viewQueriesRun.error ?? undefined}
          close={() => setViewQueriesRunId(null)}
        />
      )}
      <Modal.Root
        open={viewQueriesRun ? false : true}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) close();
        }}
        size="lg"
        dismissible
        trackingEventModalType="aggregated-fact-table-refresh"
      >
        <Modal.Header>
          <Modal.Title>{`Manage refresh — ${status.idType}`}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Text as="div" color="text-mid" mb="3">
            Manually queue a materialization run for the{" "}
            <strong>{status.idType}</strong> aggregated table. Runs happen in
            the background and may take a while to complete.
          </Text>

          <dl className="row mb-3">
            <dt className="col-5">First event date</dt>
            <dd className="col-7">{formatDay(status.firstEventDate)}</dd>
            <dt className="col-5">Last event date</dt>
            <dd className="col-7">{formatDay(status.lastEventDate)}</dd>
            <dt className="col-5">Last found timestamp</dt>
            <dd className="col-7">
              {formatTimestamp(status.lastMaxTimestamp)}
            </dd>
          </dl>

          <RadioGroup
            value={mode}
            setValue={(v) => setMode(v as "incremental" | "restate")}
            options={[
              {
                value: "incremental",
                label: "Incremental refresh",
                description:
                  "Append new events since the last run. Fast and cheap.",
              },
              {
                value: "restate",
                label: "Full re-state",
                description:
                  "Drop and recreate the table, then re-scan the retained window (up to ~2-3 months of history). Significantly more expensive than an incremental refresh.",
              },
            ]}
          />

          {runError && (
            <Callout status="error" mt="3">
              {runError}
            </Callout>
          )}

          <Flex mt="3">
            <Button
              color={mode === "restate" ? "red" : "violet"}
              loading={running}
              onClick={run}
            >
              {mode === "restate"
                ? "Run full re-state"
                : "Run incremental refresh"}
            </Button>
          </Flex>

          <hr className="my-4" />

          <Heading size="small" as="h4" mb="2">
            Run history
          </Heading>
          {runs.length === 0 ? (
            <Text as="div" color="text-mid" size="small">
              No runs yet for this identifier type.
            </Text>
          ) : (
            <table className="table appbox gbtable mb-0">
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Mode</th>
                  <th>Status</th>
                  <th style={{ width: 1 }} />
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td>{formatTimestamp(r.runStarted ?? r.dateCreated)}</td>
                    <td>{r.mode}</td>
                    <td>
                      <Badge
                        color={runStatusColor[r.status]}
                        label={runStatusLabel(r.status)}
                        variant="soft"
                      />
                      {r.error && (
                        <Tooltip body={r.error}>
                          <span className="text-danger ml-2 small">
                            (error)
                          </span>
                        </Tooltip>
                      )}
                    </td>
                    <td>
                      {r.queryIds.length > 0 ? (
                        <Button
                          variant="ghost"
                          onClick={() => setViewQueriesRunId(r.id)}
                        >
                          View queries
                        </Button>
                      ) : (
                        <Text color="text-mid" size="small">
                          No queries
                        </Text>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Modal.Body>
        <Modal.Footer justify="end">
          <Modal.Close>
            <Button variant="ghost" onClick={close}>
              Close
            </Button>
          </Modal.Close>
        </Modal.Footer>
      </Modal.Root>
    </>
  );
}

export default function AggregatedFactTablesCard({ factTable }: Props) {
  const { hasCommercialFeature } = useUser();
  const permissionsUtil = usePermissionsUtil();

  // The id type currently being managed in the refresh modal (null = closed).
  const [manageIdType, setManageIdType] = useState<string | null>(null);

  const idTypes = factTable.aggregatedFactTableIdTypes ?? [];

  const { data, mutate } = useApi<{
    aggregatedFactTables: AggregatedFactTableStatus[];
    nextScheduledUpdate: string | null;
  }>(`/fact-tables/${factTable.id}/aggregated-tables`, {
    shouldRun: () =>
      hasCommercialFeature("pipeline-mode") && idTypes.length > 0,
  });

  // Only show the card when the feature is licensed and at least one id type is
  // configured for materialization.
  if (!hasCommercialFeature("pipeline-mode") || idTypes.length === 0) {
    return null;
  }

  const canEdit = permissionsUtil.canUpdateFactTable(factTable, {});

  const statusByIdType = new Map(
    (data?.aggregatedFactTables ?? []).map((s) => [s.idType, s]),
  );

  const nextScheduledUpdate = data?.nextScheduledUpdate ?? null;

  // Always render a row per configured id type, even if it has not been
  // materialized yet (no registry doc => empty dates).
  const rows: AggregatedFactTableStatus[] = idTypes.map(
    (idType) =>
      statusByIdType.get(idType) ?? {
        idType,
        status: "pending",
        tableFullName: null,
        firstEventDate: null,
        lastEventDate: null,
        lastMaxTimestamp: null,
        lastError: null,
        dateUpdated: null,
      },
  );

  const manageStatus = manageIdType
    ? rows.find((r) => r.idType === manageIdType)
    : undefined;

  return (
    <Frame px="5" pt="3" pb="4" mb="4">
      <Heading size="medium" as="h3" mb="1">
        Shared Daily Aggregated Tables
      </Heading>
      <Text as="div" color="text-mid" mb="3">
        A nightly job maintains a shared daily aggregated table for each
        identifier type below. These pre-aggregate metric values per day and are
        used to speed up CUPED.
      </Text>

      <table className="table appbox gbtable mt-2 mb-0">
        <thead>
          <tr>
            <th>Identifier type</th>
            <th>Status</th>
            <th>First event date</th>
            <th>Last event date</th>
            <th>Last found timestamp</th>
            <th>Last updated</th>
            <th>Next scheduled update</th>
            {canEdit && <th style={{ width: 30 }} />}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.idType}>
              <td>
                <Text weight="medium">{row.idType}</Text>
              </td>
              <td>
                <Badge
                  color={materializationStatusDisplay[row.status].color}
                  label={materializationStatusDisplay[row.status].label}
                  variant="soft"
                />
                {row.status === "error" && row.lastError && (
                  <Tooltip body={row.lastError}>
                    <span className="text-danger ml-2 small">(details)</span>
                  </Tooltip>
                )}
              </td>
              <td>{formatDay(row.firstEventDate)}</td>
              <td>{formatDay(row.lastEventDate)}</td>
              <td>{formatTimestamp(row.lastMaxTimestamp)}</td>
              <td>{formatTimestamp(row.dateUpdated)}</td>
              <td>
                {row.status === "running"
                  ? "—"
                  : formatTimestamp(nextScheduledUpdate)}
              </td>
              {canEdit && (
                <td>
                  <DropdownMenu
                    trigger={
                      <IconButton
                        variant="ghost"
                        color="gray"
                        radius="full"
                        size="2"
                        highContrast
                      >
                        <BsThreeDotsVertical size={16} />
                      </IconButton>
                    }
                    menuPlacement="end"
                  >
                    <DropdownMenuGroup>
                      <DropdownMenuItem
                        onClick={() => setManageIdType(row.idType)}
                      >
                        Manage refresh
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenu>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {manageStatus && (
        <ManageRefreshModal
          factTable={factTable}
          status={manageStatus}
          close={async () => {
            setManageIdType(null);
            // Refresh the status table so a just-queued run is reflected.
            await mutate();
          }}
        />
      )}
    </Frame>
  );
}

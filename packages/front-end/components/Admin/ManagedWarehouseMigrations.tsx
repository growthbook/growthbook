import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import ConfirmDialog from "@/ui/ConfirmDialog";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import { Select, SelectItem } from "@/ui/Select";
import Text from "@/ui/Text";
import Tooltip from "@/ui/Tooltip";
import {
  OrgTarget,
  OrgTargetPicker,
  parseOrgIds,
} from "@/components/Admin/ManagedWarehouseRecreate";

// Poll while warehouses are waiting on the migration sweep
const POLL_INTERVAL_MS = 15000;

type MigrationsResponse = {
  latestVersion: number;
  applied: { version: number; count: number }[];
  pending: number;
};

export function MigrationVersionSelect({
  latest,
  min = 0,
  value,
  setValue,
}: {
  latest: number;
  // Applied migrations are never undone, so lower versions aren't offered
  min?: number;
  value: number;
  setValue: (value: number) => void;
}) {
  return (
    <Select
      label="Desired version"
      value={String(value)}
      setValue={(v) => setValue(Number(v))}
    >
      {Array.from({ length: latest - min + 1 }, (_, i) => (
        <SelectItem key={min + i} value={String(min + i)}>
          {String(min + i)}
        </SelectItem>
      ))}
    </Select>
  );
}

/** Super-admin panel for rolling out Managed Warehouse migrations across orgs. */
export default function ManagedWarehouseMigrations({
  canRequest,
}: {
  canRequest: boolean;
}) {
  const { apiCall } = useAuth();
  const { data, error, mutate } = useApi<MigrationsResponse>(
    "/admin/managed-warehouse/migrations",
    {
      refreshInterval: (latest) =>
        latest && latest.pending > 0 ? POLL_INTERVAL_MS : 0,
    },
  );

  const [version, setVersion] = useState<number | null>(null);
  const [target, setTarget] = useState<OrgTarget>("list");
  const [orgIds, setOrgIds] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState("");
  const [submitError, setSubmitError] = useState("");

  const organizations = parseOrgIds(orgIds);
  const submitDisabledReason =
    target === "list" && !organizations.length
      ? "Enter at least one organization ID"
      : "";
  const selectedVersion = version ?? data?.latestVersion ?? 0;
  const total = (data?.applied ?? []).reduce((sum, a) => sum + a.count, 0);

  const submit = async () => {
    setMessage("");
    setSubmitError("");
    try {
      const { updated } = await apiCall<{ updated: number }>(
        "/admin/managed-warehouse/migrations",
        {
          method: "POST",
          body: JSON.stringify({
            version: selectedVersion,
            organizations: target === "all" ? "all" : organizations,
          }),
        },
      );
      setMessage(
        `Set desired version ${selectedVersion} on ${updated} Managed Warehouse${updated === 1 ? "" : "s"}.`,
      );
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e));
    }
    await mutate();
  };

  return (
    <Frame py="4" px="5">
      {confirming && (
        <ConfirmDialog
          title="Set Desired Version"
          content={`Set desired version ${selectedVersion} for ${
            target === "all"
              ? "every Managed Warehouse"
              : `${organizations.length} organization${organizations.length === 1 ? "" : "s"}`
          }? Migrations run in the background and can't be undone.`}
          yesText="Set version"
          onConfirm={async () => {
            setConfirming(false);
            await submit();
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
      <Heading as="h3" size="sm" mb="3">
        Migrations
      </Heading>
      {error && <Callout status="error">{error.message}</Callout>}
      {!data && !error && <Text color="text-mid">Loading…</Text>}
      {data && (
        <Flex gap="5" mb="4" wrap="wrap">
          <Text>Latest version: {data.latestVersion}</Text>
          {data.applied.map((a) => (
            <Text key={a.version}>
              On version {a.version}: {a.count}
            </Text>
          ))}
          <Text>Pending: {data.pending}</Text>
        </Flex>
      )}
      {canRequest && data && (
        <Flex direction="column" gap="4" align="start">
          <Box width="200px">
            <MigrationVersionSelect
              latest={data.latestVersion}
              value={selectedVersion}
              setValue={setVersion}
            />
          </Box>
          <OrgTargetPicker
            target={target}
            setTarget={setTarget}
            orgIds={orgIds}
            setOrgIds={setOrgIds}
            allCount={total}
          />
          <Tooltip
            content={submitDisabledReason}
            enabled={!!submitDisabledReason}
          >
            {/* A disabled button gets no hover events, so the span does */}
            <span>
              <Button
                disabled={!!submitDisabledReason}
                onClick={() => setConfirming(true)}
              >
                Submit
              </Button>
            </span>
          </Tooltip>
        </Flex>
      )}
      {message && (
        <Callout status="success" mt="3">
          {message}
        </Callout>
      )}
      {submitError && (
        <Callout status="error" mt="3">
          {submitError}
        </Callout>
      )}
    </Frame>
  );
}

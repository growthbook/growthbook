import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import ConfirmDialog from "@/ui/ConfirmDialog";
import Frame from "@/ui/Frame";
import Heading from "@/ui/Heading";
import RadioGroup from "@/ui/RadioGroup";
import { Select, SelectItem } from "@/ui/Select";
import Text from "@/ui/Text";
import TextField from "@/ui/TextField";

// Poll while warehouses are waiting on the migration sweep
const POLL_INTERVAL_MS = 15000;

type MigrationsResponse = {
  latestVersion: number;
  applied: { version: number; count: number }[];
  pending: number;
};

export function MigrationVersionSelect({
  latest,
  value,
  setValue,
}: {
  latest: number;
  value: number;
  setValue: (value: number) => void;
}) {
  return (
    <Select
      label="Desired version"
      value={String(value)}
      setValue={(v) => setValue(Number(v))}
    >
      {Array.from({ length: latest + 1 }, (_, v) => (
        <SelectItem key={v} value={String(v)}>
          {String(v)}
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
  const [target, setTarget] = useState<"all" | "list">("list");
  const [orgIds, setOrgIds] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState("");
  const [submitError, setSubmitError] = useState("");

  const organizations = orgIds
    .split(/[\s,]+/)
    .map((id) => id.trim())
    .filter(Boolean);
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
          <Flex direction="column" gap="2">
            <Text weight="semibold">Organizations</Text>
            <RadioGroup
              value={target}
              setValue={(v) => setTarget(v as "all" | "list")}
              options={[
                {
                  value: "list",
                  label: "Selected organizations",
                  renderOnSelect: (
                    // Indented to line up with the option's label
                    <Box pl="5" mb="2" width="440px" maxWidth="100%">
                      <TextField
                        multiline
                        aria-label="Organization IDs"
                        placeholder="org_abc123, org_def456"
                        value={orgIds}
                        onChange={(e) => setOrgIds(e.target.value)}
                      />
                    </Box>
                  ),
                  renderOutsideItem: true,
                },
                {
                  value: "all",
                  label: `All Managed Warehouses (${total})`,
                },
              ]}
            />
          </Flex>
          <Button
            disabled={target === "list" && !organizations.length}
            onClick={() => setConfirming(true)}
          >
            Submit
          </Button>
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

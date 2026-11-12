import { useRef, useState } from "react";
import useSWR from "swr";
import { Flex } from "@radix-ui/themes";
import { EventForwarderSinkType } from "shared/types/event-forwarder";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { useAuth } from "@/services/auth";
import {
  DropdownMenu,
  DropdownMenuItem,
  MoreMenuTrigger,
} from "@/ui/DropdownMenu";
import HelperText from "@/ui/HelperText";
import SelectField from "@/components/Forms/SelectField";
import Text from "@/ui/Text";

const SINK_TYPE_LABELS: Record<EventForwarderSinkType, string> = {
  bigquery: "BigQuery",
  snowflake: "Snowflake",
  databricks: "Databricks",
};

// Own state: the confirmation content is rendered once and kept
function MigrateEnvironmentField({
  environments,
  initial,
  onChange,
}: {
  environments: string[];
  initial: string;
  onChange: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <SelectField
      size="md"
      legacyLabelFormatting={false}
      label="Environment"
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange(v);
      }}
      initialOption="All Environments"
      options={environments.map((e) => ({ label: e, value: e }))}
      helpText="Must not overlap another Event Forwarder in this organization."
    />
  );
}

// Lists an organization's event forwarders with their actions. Every call runs
// inside that organization, so the caller must be able to get in.
export default function EventForwarders({
  orgId,
  environments,
}: {
  orgId: string;
  environments: string[];
}) {
  const migrateEnvironment = useRef("");
  const { apiCall } = useAuth();
  // Not useApi, which can only fetch for the current organization
  const { data, error, mutate } = useSWR(
    `admin::${orgId}::event-forwarders`,
    async () => {
      const res = await apiCall<{
        datasources: DataSourceInterfaceWithParams[];
      }>("/organization/definitions", {
        headers: { "X-Organization": orgId },
      });
      return res.datasources.flatMap((ds) =>
        ds.eventForwarderConfig
          ? [{ id: ds.id, name: ds.name, ...ds.eventForwarderConfig }]
          : [],
      );
    },
  );

  const run =
    (datasourceId: string, action: string, method = "POST", body?: object) =>
    async () => {
      await apiCall(`/datasource/${datasourceId}/event-forwarder${action}`, {
        method,
        headers: { "X-Organization": orgId },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      await mutate();
    };

  // Controlled, so Pause and Resume can stay open to show a failed request
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  if (error) {
    return (
      <HelperText status="error" size="sm">
        Couldn&apos;t load: {error.message}
      </HelperText>
    );
  }
  if (!data) return <Text color="text-mid">Loading...</Text>;
  if (!data.length) return <>None</>;

  return (
    <Flex direction="column" gap="2">
      {data.map((row) => (
        <Flex key={row.id} align="center" gap="2">
          {/* Stacked, since the right rail is too narrow for one line */}
          <Flex direction="column" flexGrow="1" minWidth="0">
            <Text>{row.name}</Text>
            <Text color="text-mid" size="sm">
              {SINK_TYPE_LABELS[row.sinkType]} ·{" "}
              {row.environment || "All Environments"}
              {row.status === "paused" ? " · Paused" : ""}
            </Text>
          </Flex>
          <DropdownMenu
            trigger={
              <MoreMenuTrigger size="sm" label={`Actions for ${row.name}`} />
            }
            menuPlacement="end"
            open={openMenu === row.id}
            onOpenChange={(open) => setOpenMenu(open ? row.id : null)}
          >
            {/* Server rejects migrating a paused row, so don't offer it */}
            {!row.inHouseConsumer && row.status !== "paused" && (
              <DropdownMenuItem
                confirmation={{
                  confirmationTitle: "Migrate to in-house consumer?",
                  cta: "Migrate",
                  submit: () =>
                    run(row.id, "/migrate", "POST", {
                      environment: migrateEnvironment.current,
                    })(),
                  getConfirmationContent: async () => {
                    migrateEnvironment.current = row.environment ?? "";
                    return (
                      <Flex direction="column" gap="3">
                        <Text>
                          {`New events for ${row.name} go to the in-house consumer right away. Events already queued still go through the Confluent connector. Tear it down manually once it has drained. This cannot be undone from the UI.`}
                        </Text>
                        <MigrateEnvironmentField
                          environments={environments}
                          initial={row.environment ?? ""}
                          onChange={(v) => (migrateEnvironment.current = v)}
                        />
                      </Flex>
                    );
                  },
                }}
              >
                Migrate to in-house consumer
              </DropdownMenuItem>
            )}
            {(row.status === "ready" || row.status === "paused") && (
              <DropdownMenuItem
                onClick={async (e) => {
                  e.preventDefault();
                  await run(
                    row.id,
                    row.status === "ready" ? "/pause" : "/resume",
                  )();
                  setOpenMenu(null);
                }}
              >
                {row.status === "ready" ? "Pause" : "Resume"}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              color="red"
              confirmation={{
                confirmationTitle: "Delete Event Forwarder Configuration?",
                cta: "Delete",
                submit: run(row.id, "", "DELETE"),
                getConfirmationContent: async () =>
                  "This cannot be undone from the UI.",
              }}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenu>
        </Flex>
      ))}
    </Flex>
  );
}

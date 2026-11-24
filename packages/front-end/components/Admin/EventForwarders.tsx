import { useCallback, useEffect, useRef, useState } from "react";
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
import {
  EventForwarderEnvironmentSelect,
  EventForwarderNarrowingWarning,
  narrowsEventForwarderEnvironments,
} from "@/components/DataSourceSetup/EventForwarderDestinationFields";
import Callout from "@/ui/Callout";
import Text from "@/ui/Text";

const SINK_TYPE_LABELS: Record<EventForwarderSinkType, string> = {
  bigquery: "BigQuery",
  snowflake: "Snowflake",
  databricks: "Databricks",
};

function neverReceivedEvents(r: { status: string; connectorName?: string }) {
  return (
    r.status === "unconfigured" || (r.status === "error" && !r.connectorName)
  );
}

// Super Admin environment picker
// - Reports its value from an effect: the menu re-runs the confirmation
//   content on parent re-renders, which must not reset the pick
// - Never locked; All only for the organization's only forwarder
// - Shows a single saved environment; the help text lists the rest
function AdminEnvironmentField({
  saved,
  onlyForwarder,
  onChange,
  ...props
}: {
  environments: string[];
  others: string[];
  savedAll: boolean;
  saved: string[];
  onlyForwarder: boolean;
  onChange: (environments: string[]) => void;
}) {
  // null until picked, so an untouched field keeps every saved environment
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    onChange(picked === null ? saved : picked ? [picked] : []);
  }, [picked, saved, onChange]);
  const value = picked ?? (saved.length === 1 ? saved[0] : "");
  return (
    <>
      {props.others.includes("") && !props.savedAll ? (
        <Callout status="warning" mb="3">
          Another Event Forwarder receives all environments. Set it to one
          environment first, so events are not sent twice.
        </Callout>
      ) : null}
      <EventForwarderEnvironmentSelect
        {...props}
        allowAll={onlyForwarder}
        helpText={`Currently forwards events from ${saved.length ? new Intl.ListFormat("en").format(saved) : "all environments"}.`}
        value={value}
        onChange={setPicked}
      />
      {picked !== null && narrowsEventForwarderEnvironments(saved, picked) ? (
        <EventForwarderNarrowingWarning value={picked} action="change" mt="3" />
      ) : null}
    </>
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
  // Set by the open dialog's AdminEnvironmentField
  const pickedEnvironments = useRef<string[]>([]);
  const setPickedEnvironments = useCallback((environments: string[]) => {
    pickedEnvironments.current = environments;
  }, []);
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

  // Same rules as the server
  // - others: same region's bound rows, plus live unbound ones ("" = all)
  type Row = NonNullable<typeof data>[number];
  const environmentFieldProps = (row: Row) => ({
    environments,
    others: (data ?? [])
      .filter(
        (r) =>
          r.id !== row.id &&
          (r.region ?? "us-east-1") === (row.region ?? "us-east-1") &&
          (r.environments?.length || !neverReceivedEvents(r)),
      )
      .flatMap((r) => (r.environments?.length ? r.environments : [""])),
    savedAll: !row.environments?.length,
    saved: row.environments ?? [],
  });

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
              {row.environments?.join(", ") || "All Environments"}
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
            <DropdownMenuItem
              confirmation={{
                confirmationTitle: "Change environment?",
                cta: "Save",
                // Reversible by a Super Admin, so not the destructive red
                ctaColor: "violet",
                submit: () =>
                  run(row.id, "/environments", "PUT", {
                    environments: pickedEnvironments.current,
                  })(),
                getConfirmationContent: async () => (
                  <AdminEnvironmentField
                    {...environmentFieldProps(row)}
                    onlyForwarder={data.length === 1}
                    onChange={setPickedEnvironments}
                  />
                ),
              }}
            >
              Change environment
            </DropdownMenuItem>
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

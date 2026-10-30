import { FC, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import { Box } from "@radix-ui/themes";
import {
  DataSourceInterfaceWithParams,
  DataSourceType,
  SchemaFormat,
} from "shared/types/datasource";
import { isTestableDataSourceType } from "shared/validators";
import ConnectDataSourceLayout from "@/components/DataSourceSetup/ConnectDataSourceLayout";
import { PASSWORD_USER_TYPES } from "@/components/DataSourceSetup/connectDataSourceHelpers";
import { ConnectSetupKind } from "@/components/DataSourceSetup/DataSourceConnectInstructions";
import { defaultEventForwarderDestination } from "@/components/DataSourceSetup/EventForwarderDestinationFields";
import { generateStrongPassword } from "@/components/DataSourceSetup/generateStrongPassword";
import LoadingOverlay from "@/components/LoadingOverlay";
import PageHead from "@/components/Layout/PageHead";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import { useNewDataSourceOnboarding } from "@/hooks/useNewDataSourceOnboarding";
import { dataSourceConnections } from "@/services/eventSchema";

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseType(
  value: string | string[] | undefined,
): DataSourceType | null {
  const raw = first(value);
  // Mixpanel is deprecated for direct use, so the new connect page skips it.
  if (!raw || raw === "mixpanel" || !isTestableDataSourceType(raw)) return null;
  return raw;
}

const NewDataSourceConnectPage: FC = () => {
  const router = useRouter();
  const { enabled, ready } = useNewDataSourceOnboarding();
  // Generated once per visit. `initial` is rebuilt as definitions load, and
  // the layout copies it back into the form until the user edits something,
  // so a password created inside that memo could change after the setup SQL
  // was already copied.
  const [generatedPassword] = useState(() => generateStrongPassword());
  const type = parseType(router.query.type);
  const setup: ConnectSetupKind =
    first(router.query.setup) === "event_forwarder"
      ? "event_forwarder"
      : "custom";
  const schemaFormat = (first(router.query.schema) || "custom") as SchemaFormat;

  useEffect(() => {
    if (ready && !enabled) {
      router.replace("/datasources");
    }
  }, [router, enabled, ready]);

  const initial = useMemo((): Partial<DataSourceInterfaceWithParams> | null => {
    if (!type) return null;
    const option = dataSourceConnections.find((c) => c.type === type);
    if (!option) return null;
    // Prefill a password so the setup SQL in the right column and the
    // Password field start out matching.
    const params = {
      ...option.default,
      ...(PASSWORD_USER_TYPES.has(option.type)
        ? { password: generatedPassword }
        : null),
      // Event Forwarder has no connection schema field. The destination
      // schema is the one the connection uses.
      ...(option.type === "snowflake" && setup === "event_forwarder"
        ? {
            schema: defaultEventForwarderDestination("snowflake").location,
          }
        : null),
    };
    return {
      name: option.display,
      description: "",
      type: option.type,
      params,
      settings: {},
      // Empty means All Projects. A Data Source is shared, so the Project
      // selected in the nav does not narrow it. The layout assigns specific
      // Projects when this user cannot create one for All Projects.
      projects: [],
    } as Partial<DataSourceInterfaceWithParams>;
  }, [type, setup, generatedPassword]);

  if (!ready || !enabled || !router.isReady) {
    return <LoadingOverlay />;
  }

  if (!type || !initial) {
    return (
      <Box px="6" py="5">
        <PageHead
          breadcrumb={[
            { display: "Data Sources", href: "/datasources" },
            { display: "Add Data Source", href: "/datasources/new" },
            { display: "Connect" },
          ]}
        />
        <Callout status="error">
          Choose a warehouse type from{" "}
          <Link href="/datasources/new">Add Data Source</Link> to continue.
        </Callout>
      </Box>
    );
  }

  const typeInfo = dataSourceConnections.find((c) => c.type === type);

  return (
    <>
      <PageHead
        breadcrumb={[
          { display: "Data Sources", href: "/datasources" },
          { display: "Add Data Source", href: "/datasources/new" },
          { display: typeInfo?.display || "Connect" },
        ]}
      />
      <ConnectDataSourceLayout
        mode="create"
        initial={initial}
        setup={setup}
        schemaFormat={schemaFormat}
        source="datasource-new-connect"
        onCancel={() => {
          router.push("/datasources/new");
        }}
        onSuccess={async (id) => {
          await router.push(`/datasources/${id}`);
        }}
      />
    </>
  );
};

export default NewDataSourceConnectPage;

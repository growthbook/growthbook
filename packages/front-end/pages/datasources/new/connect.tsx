import { FC, useEffect, useMemo } from "react";
import { useRouter } from "next/router";
import { Box } from "@radix-ui/themes";
import {
  DataSourceInterfaceWithParams,
  DataSourceType,
  SchemaFormat,
} from "shared/types/datasource";
import { getDefaultProjectsForNewResource } from "shared/demo-datasource";
import { isTestableDataSourceType } from "shared/validators";
import ConnectDataSourceLayout from "@/components/DataSourceSetup/ConnectDataSourceLayout";
import { ConnectSetupKind } from "@/components/DataSourceSetup/DataSourceConnectInstructions";
import { generateStrongPassword } from "@/components/DataSourceSetup/generateStrongPassword";
import LoadingOverlay from "@/components/LoadingOverlay";
import PageHead from "@/components/Layout/PageHead";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import { useNewDataSourceOnboarding } from "@/hooks/useNewDataSourceOnboarding";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { dataSourceConnections } from "@/services/eventSchema";

// Warehouses whose setup instructions create a password-authenticated user.
const PASSWORD_USER_TYPES = new Set<DataSourceType>([
  "postgres",
  "redshift",
  "mysql",
  "mssql",
]);

function parseSetup(value: string | string[] | undefined): ConnectSetupKind {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "event_forwarder" ? "event_forwarder" : "custom";
}

function parseSchemaFormat(value: string | string[] | undefined): SchemaFormat {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return "custom";
  return raw as SchemaFormat;
}

function parseType(
  value: string | string[] | undefined,
): DataSourceType | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !isTestableDataSourceType(raw)) return null;
  // Exclude Mixpanel from the new connect page — it's deprecated for direct use.
  if (raw === "mixpanel") return null;
  return raw;
}

const NewDataSourceConnectPage: FC = () => {
  const router = useRouter();
  const { enabled, ready } = useNewDataSourceOnboarding();
  const { project } = useDefinitions();
  const { orgId } = useAuth();
  const type = parseType(router.query.type);
  const setup = parseSetup(router.query.setup);
  const schemaFormat = parseSchemaFormat(router.query.schema);

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
    const params = PASSWORD_USER_TYPES.has(option.type)
      ? { ...option.default, password: generateStrongPassword() }
      : option.default;
    return {
      name: "",
      description: "",
      type: option.type,
      params,
      settings: {},
      // Start scoped to the current Project (if any) so Project-level
      // creators can test and save without first changing the picker.
      projects: getDefaultProjectsForNewResource({
        project,
        organizationId: orgId || undefined,
      }),
    } as Partial<DataSourceInterfaceWithParams>;
  }, [type, project, orgId]);

  if (!ready || !enabled) {
    return <LoadingOverlay />;
  }

  if (!router.isReady) {
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

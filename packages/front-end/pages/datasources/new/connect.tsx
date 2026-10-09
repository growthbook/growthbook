import { FC, useEffect, useMemo } from "react";
import { useRouter } from "next/router";
import {
  DataSourceInterfaceWithParams,
  DataSourceType,
  SchemaFormat,
} from "shared/types/datasource";
import { isTestableDataSourceType } from "shared/validators";
import ConnectDataSourceLayout from "@/components/DataSourceSetup/ConnectDataSourceLayout";
import { ConnectSetupKind } from "@/components/DataSourceSetup/DataSourceConnectInstructions";
import LoadingOverlay from "@/components/LoadingOverlay";
import PageHead from "@/components/Layout/PageHead";
import Callout from "@/ui/Callout";
import Link from "@/ui/Link";
import { useNewDataSourceOnboarding } from "@/hooks/useNewDataSourceOnboarding";
import { dataSourceConnections } from "@/services/eventSchema";

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
    return {
      name: "",
      description: "",
      type: option.type,
      params: option.default,
      settings: {},
    } as Partial<DataSourceInterfaceWithParams>;
  }, [type]);

  if (!ready || !enabled) {
    return <LoadingOverlay />;
  }

  if (!router.isReady) {
    return <LoadingOverlay />;
  }

  if (!type || !initial) {
    return (
      <div className="container pagecontents">
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
      </div>
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

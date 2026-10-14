import { FC, useEffect } from "react";
import { useRouter } from "next/router";
import { Box } from "@radix-ui/themes";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { isSampleDatasource } from "shared/demo-datasource";
import { isTestableDataSourceType } from "shared/validators";
import ConnectDataSourceLayout from "@/components/DataSourceSetup/ConnectDataSourceLayout";
import LoadingOverlay from "@/components/LoadingOverlay";
import PageHead from "@/components/Layout/PageHead";
import Callout from "@/ui/Callout";
import useApi from "@/hooks/useApi";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { hasFileConfig } from "@/services/env";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useNewDataSourceOnboarding } from "@/hooks/useNewDataSourceOnboarding";

const EditDataSourceConnectPage: FC = () => {
  const router = useRouter();
  const { did } = router.query as { did: string };
  const { enabled, ready: flagReady } = useNewDataSourceOnboarding();
  const { orgId } = useAuth();
  const permissionsUtil = usePermissionsUtil();
  const { mutateDefinitions } = useDefinitions();
  const {
    data: d,
    error,
    mutate: mutateCurrentDataSource,
  } = useApi<DataSourceInterfaceWithParams>(`/datasource/${did}`, {
    shouldRun: () => !!did,
  });

  useEffect(() => {
    if (flagReady && !enabled) {
      router.replace(did ? `/datasources/${did}` : "/datasources");
    }
  }, [router, enabled, flagReady, did]);

  if (!flagReady || !enabled) {
    return <LoadingOverlay />;
  }

  if (error) {
    return (
      <Box px="6" py="5">
        <Callout status="error">{error.message}</Callout>
      </Box>
    );
  }

  if (!d) {
    return <LoadingOverlay />;
  }

  const isManagedWarehouse = d.type === "growthbook_clickhouse";
  const isSampleDataSource = isSampleDatasource({
    datasourceId: d.id,
    type: d.type,
    host: d.params && "host" in d.params ? d.params.host : undefined,
    projects: d.projects,
    organizationId: orgId ?? undefined,
  });
  const canUpdateConnectionParams =
    !isManagedWarehouse &&
    !isSampleDataSource &&
    permissionsUtil.canUpdateDataSourceParams(d) &&
    !hasFileConfig() &&
    isTestableDataSourceType(d.type);

  if (!canUpdateConnectionParams) {
    return (
      <Box px="6" py="5">
        <PageHead
          breadcrumb={[
            { display: "Data Sources", href: "/datasources" },
            { display: d.name, href: `/datasources/${d.id}` },
            { display: "Edit Connection" },
          ]}
        />
        <Callout status="error">
          You cannot edit connection info for this Data Source.
        </Callout>
      </Box>
    );
  }

  const setup =
    (d.eventForwarderConfig ?? null) !== null ? "event_forwarder" : "custom";

  return (
    <>
      <PageHead
        breadcrumb={[
          { display: "Data Sources", href: "/datasources" },
          { display: d.name, href: `/datasources/${d.id}` },
          { display: "Edit Connection" },
        ]}
      />
      <ConnectDataSourceLayout
        mode="edit"
        initial={d}
        setup={setup}
        source="datasource-edit-connect"
        onCancel={() => {
          router.push(`/datasources/${d.id}`);
        }}
        onSuccess={async () => {
          await Promise.all([mutateDefinitions({}), mutateCurrentDataSource()]);
          await router.push(`/datasources/${d.id}`);
        }}
      />
    </>
  );
};

export default EditDataSourceConnectPage;

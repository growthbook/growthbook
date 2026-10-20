import { useRouter } from "next/router";
import { FC, useCallback, useEffect, useState } from "react";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import {
  isManagedWarehouseAwaitingProvisioning,
  supportsEventForwarder,
} from "shared/util";
import { isSampleDatasource } from "shared/demo-datasource";
import { Box, Flex } from "@radix-ui/themes";
import { PiLinkBold } from "react-icons/pi";
import { datetime } from "shared/dates";
import { useFeatureValue } from "@growthbook/growthbook-react";
import ManagedWarehouseNoEventsCallout from "@/components/ManagedWarehouse/ManagedWarehouseNoEventsCallout";
import Link from "@/ui/Link";
import { useAuth } from "@/services/auth";
import {
  getDataRegionLabel,
  DEFAULT_DATA_REGION,
} from "@/services/dataRegions";
import { useDefinitions } from "@/services/DefinitionsContext";
import { hasFileConfig } from "@/services/env";
import { DocLink } from "@/components/DocLink";
import { DataSourceInlineEditIdentifierTypes } from "@/components/Settings/EditDataSource/DataSourceInlineEditIdentifierTypes/DataSourceInlineEditIdentifierTypes";
import { DataSourceInlineEditIdentityJoins } from "@/components/Settings/EditDataSource/DataSourceInlineEditIdentityJoins/DataSourceInlineEditIdentityJoins";
import { ExperimentAssignmentQueries } from "@/components/Settings/EditDataSource/ExperimentAssignmentQueries/ExperimentAssignmentQueries";
import { ContextualBanditAssignmentQueries } from "@/components/Settings/EditDataSource/ContextualBanditAssignmentQueries/ContextualBanditAssignmentQueries";
import { DataSourceViewEditExperimentProperties } from "@/components/Settings/EditDataSource/DataSourceExperimentProperties/DataSourceViewEditExperimentProperties";
import { DataSourceJupyterNotebookQuery } from "@/components/Settings/EditDataSource/DataSourceJupypterQuery/DataSourceJupyterNotebookQuery";
import DataSourceForm from "@/components/Settings/DataSourceForm";
import Code from "@/components/SyntaxHighlighting/Code";
import LoadingOverlay from "@/components/LoadingOverlay";
import useApi from "@/hooks/useApi";
import DataSourcePipeline from "@/components/Settings/EditDataSource/DataSourcePipeline/DataSourcePipeline";
import AskDataSettings from "@/components/Settings/EditDataSource/AskDataSettings/AskDataSettings";
import { useUser } from "@/services/UserContext";
import PageHead from "@/components/Layout/PageHead";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import { useNewDataSourceOnboarding } from "@/hooks/useNewDataSourceOnboarding";
import FinishSettingUp, {
  isDataSourceSetupComplete,
  useExposureQuerySkipped,
} from "@/components/DataSourceSetup/FinishSettingUp";
import Badge from "@/ui/Badge";
import Callout from "@/ui/Callout";
import ConfirmDialog from "@/ui/ConfirmDialog";
import ProjectBadges from "@/components/ProjectBadges";
import Frame from "@/ui/Frame";
import ClickhouseManagedWarehouseIdentifiers from "@/components/Settings/EditDataSource/ClickhouseManagedWarehouseIdentifiers";
import SqlExplorerModal from "@/components/SchemaBrowser/SqlExplorerModal";
import { useCombinedMetrics } from "@/components/Metrics/MetricsList";
import { FeatureEvaluationQueries } from "@/components/Settings/EditDataSource/FeatureEvaluationQueries/FeatureEvaluationQueries";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import HistoryTable from "@/components/HistoryTable";
import EventForwarder from "@/components/Settings/EditDataSource/EventForwarder/EventForwarder";
import EditProjectsForm from "@/components/Projects/EditProjectsForm";
import { GBEdit } from "@/components/Icons";
import DataSourceDescription from "@/components/Settings/EditDataSource/DataSourceDescription";
import LinkButton from "@/ui/LinkButton";
import Button from "@/ui/Button";
import Explorer from "@/enterprise/components/ProductAnalytics/Explorer";
import DataList from "@/ui/DataList";
import TextField from "@/ui/TextField";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import { DataSourceUsage } from "@/pages/datasources/queries/[did]";

const CONNECTION_DETAIL_FIELDS: { key: string; label: string }[] = [
  { key: "host", label: "Host" },
  { key: "server", label: "Server" },
  { key: "url", label: "URL" },
  { key: "accessUrl", label: "Access URL" },
  { key: "account", label: "Account" },
  { key: "port", label: "Port" },
  { key: "database", label: "Database" },
  { key: "user", label: "User" },
  { key: "username", label: "Username" },
  { key: "defaultSchema", label: "Schema" },
  { key: "schema", label: "Schema" },
  { key: "catalog", label: "Catalog" },
  { key: "projectId", label: "Project" },
  { key: "defaultProject", label: "Default project" },
  { key: "defaultDataset", label: "Default dataset" },
  { key: "warehouse", label: "Warehouse" },
  { key: "role", label: "Role" },
  { key: "region", label: "Region" },
  { key: "workGroup", label: "Workgroup" },
  { key: "path", label: "HTTP path" },
  { key: "viewId", label: "View" },
  { key: "authType", label: "Authentication" },
  { key: "authMethod", label: "Authentication" },
];

function getConnectionDetails(
  datasource: DataSourceInterfaceWithParams,
): { label: string; value: string }[] {
  const params = datasource.params;
  if (!params || typeof params !== "object") return [];
  const record = params as Record<string, unknown>;
  return CONNECTION_DETAIL_FIELDS.flatMap(({ key, label }) => {
    if (!(key in record)) return [];
    const value = record[key];
    if (typeof value !== "string" && typeof value !== "number") return [];
    if (value === "") return [];
    return [{ label, value: String(value) }];
  });
}

function quotePropertyName(name: string) {
  if (name.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/)) {
    return name;
  }
  return JSON.stringify(name);
}

function ResourceReferenceList({
  title,
  items,
  emptyText,
}: {
  title: string;
  items: { id: string; name: string; href: string }[] | null;
  emptyText: string;
}) {
  return (
    <Box>
      <Heading as="h3" size="sm" mb="2">
        {title}
      </Heading>
      {items === null ? (
        <Text color="text-mid">Loading…</Text>
      ) : items.length > 0 ? (
        <Flex direction="column" gap="1">
          {items.map((item) => (
            <Link key={item.id} href={item.href}>
              {item.name}
            </Link>
          ))}
        </Flex>
      ) : (
        <Text color="text-mid">{emptyText}</Text>
      )}
    </Box>
  );
}

function MixpanelTrackingInstructions({
  dataSource,
}: {
  dataSource: DataSourceInterfaceWithParams;
}) {
  return (
    <Box>
      <Heading size="sm" as="h3" mb="1">
        Mixpanel Tracking Instructions
      </Heading>
      <Text as="p" mb="3">
        This example is for JavaScript and uses the settings above. Other
        languages should be similar.
      </Text>
      <Code
        language="javascript"
        code={`
// Tracking Callback for GrowthBook SDK
const growthbook = new GrowthBook({
  ...,
  trackingCallback: function(experiment, result) {
    mixpanel.track(${JSON.stringify(
      dataSource.settings?.events?.experimentEvent || "$experiment_started",
    )}, {
      ${quotePropertyName(
        dataSource.settings?.events?.experimentIdProperty || "Experiment name",
      )}: experiment.key,
      ${quotePropertyName(
        dataSource.settings?.events?.variationIdProperty || "Variant name",
      )}:  result.variationId,
      $source: 'growthbook'
    })
  }
})

// When Mixpanel loads, pass the distinct_id into the SDK
mixpanel.init('YOUR PROJECT TOKEN', {
  loaded: function(mixpanel) {
    growthbook.setAttributes({
      ...growthbook.getAttributes(),
      id: mixpanel.get_distinct_id()
    })
  }
})
        `.trim()}
      />
    </Box>
  );
}

export const EAQ_ANCHOR_ID = "experiment-assignment-queries";
export const CBAQ_ANCHOR_ID = "contextual-bandit-assignment-queries";

const DataSourcePage: FC = () => {
  const permissionsUtil = usePermissionsUtil();
  const newDataSourceOnboarding = useNewDataSourceOnboarding();
  const [editConn, setEditConn] = useState(false);
  const [viewSqlExplorer, setViewSqlExplorer] = useState(false);
  const [editProjectsOpen, setEditProjectsOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [dataSourceName, setDataSourceName] = useState("");
  const [dataSourceNameError, setDataSourceNameError] = useState<string | null>(
    null,
  );
  const [savingDataSourceName, setSavingDataSourceName] = useState(false);
  const [
    deleteBlockedByEventForwarderModalOpen,
    setDeleteBlockedByEventForwarderModalOpen,
  ] = useState(false);
  const router = useRouter();

  const {
    getDatasourceById,
    mutateDefinitions,
    ready,
    error,
    projects,
    factTables: allFactTables,
  } = useDefinitions();
  const { did } = router.query as { did: string };
  const definitionDataSource = getDatasourceById(did);
  const {
    data: currentDataSource,
    error: currentDataSourceError,
    mutate: mutateCurrentDataSource,
  } = useApi<DataSourceInterfaceWithParams>(`/datasource/${did}`, {
    shouldRun: () => !!did,
  });
  const loadingCurrentDataSource =
    !!did && !currentDataSource && !currentDataSourceError;
  const d = currentDataSource || definitionDataSource;

  const combinedMetrics = useCombinedMetrics({});
  const metrics = combinedMetrics.filter((m) => m.datasource === did);
  const factTables = allFactTables.filter((ft) => ft.datasource === did);
  const { data: experimentsData, error: experimentsError } = useApi<{
    experiments: ExperimentInterfaceStringDates[];
  }>("/experiments?project=&includeArchived=&type=", {
    shouldRun: () => !!did,
  });
  const experiments = experimentsData
    ? experimentsData.experiments.filter(
        (experiment) => experiment.datasource === did,
      )
    : experimentsError
      ? []
      : null;
  const { skipped: exposureQuerySkipped, skip: skipExposureQuery } =
    useExposureQuerySkipped(did);

  useEffect(() => {
    setDataSourceName(d?.name ?? "");
    setDataSourceNameError(null);
  }, [d?.name]);

  const { apiCall, orgId } = useAuth();
  const { hasCommercialFeature, settings: orgSettings } = useUser();
  // Default ON; the remote flag only turns this off for specific orgs.
  const contextualBanditsEnabled = useFeatureValue("contextual-bandits", true);

  const isManagedWarehouse = d?.type === "growthbook_clickhouse";
  // Only the never-provisioned state replaces the settings UI with the onboarding
  // callout. A transient migration must NOT blank the config page — query sub-surfaces
  // (SQL explorer, schema browser) gate themselves on the broader "unavailable" check.
  const managedWarehouseAwaitingProvisioning = d
    ? isManagedWarehouseAwaitingProvisioning(d)
    : false;

  const canDelete =
    (d && permissionsUtil.canDeleteDataSource(d) && !hasFileConfig()) || false;

  const deleteBlockedByEventForwarder = Boolean(d?.eventForwarderConfig);

  // The sample Data Source connects to a shared, GrowthBook-operated database.
  // Its connection info is never editable — repointing it would break the
  // sample data and it would still be removed by "Delete Sample Data".
  const isSampleDataSource = isSampleDatasource({
    datasourceId: d?.id,
    type: d?.type,
    host: d?.params && "host" in d.params ? d.params.host : undefined,
    projects: d?.projects,
    organizationId: orgId ?? undefined,
  });

  const canUpdateConnectionParams =
    (d &&
      !isManagedWarehouse &&
      !isSampleDataSource &&
      permissionsUtil.canUpdateDataSourceParams(d) &&
      !hasFileConfig()) ||
    false;

  const canUpdateDataSourceSettings =
    (d && permissionsUtil.canUpdateDataSourceSettings(d) && !hasFileConfig()) ||
    false;

  const pipelineEnabled = hasCommercialFeature("pipeline-mode");
  const eventsForwarderFlag = useFeatureValue(
    "events-forwarder-multi-step",
    "OFF",
  );

  /**
   * Update the data source provided.
   * Each section is responsible for retaining the rest of the data source and editing its specific section.
   */
  const updateDataSourceSettings = useCallback(
    async (dataSource: DataSourceInterfaceWithParams) => {
      await apiCall(`/datasource/${dataSource.id}`, {
        method: "PUT",
        body: JSON.stringify({
          settings: dataSource.settings,
        }),
      });
      await Promise.all([mutateDefinitions({}), mutateCurrentDataSource()]);
    },
    [mutateDefinitions, mutateCurrentDataSource, apiCall],
  );

  const saveDataSourceName = useCallback(async () => {
    const name = dataSourceName.trim();
    if (!d || !name || name === d.name || savingDataSourceName) return;

    setSavingDataSourceName(true);
    setDataSourceNameError(null);
    try {
      await apiCall(`/datasource/${d.id}`, {
        method: "PUT",
        body: JSON.stringify({ name }),
      });
      await Promise.all([mutateDefinitions({}), mutateCurrentDataSource()]);
    } catch (error) {
      setDataSourceNameError(
        error instanceof Error
          ? error.message
          : "Failed to save the Data Source name.",
      );
    } finally {
      setSavingDataSourceName(false);
    }
  }, [
    apiCall,
    d,
    dataSourceName,
    mutateCurrentDataSource,
    mutateDefinitions,
    savingDataSourceName,
  ]);

  if (error || currentDataSourceError) {
    return (
      <div className="container pagecontents">
        <Callout status="error">
          {error || currentDataSourceError?.message}
        </Callout>
      </div>
    );
  }
  if (!ready || loadingCurrentDataSource) {
    return <LoadingOverlay />;
  }
  if (!d) {
    return (
      <div className="container pagecontents">
        <Callout status="error">
          Datasource <code>{did}</code> does not exist.
        </Callout>
      </div>
    );
  }

  const supportsSQL = d.properties?.queryLanguage === "sql";
  const connectionDetails = getConnectionDetails(d);
  const supportsEvents = d.properties?.events || false;
  const datasourceSupportsEventForwarder = supportsEventForwarder(d);
  const showFinishSettingUp =
    supportsSQL &&
    !isManagedWarehouse &&
    newDataSourceOnboarding.enabled &&
    !isDataSourceSetupComplete(d, factTables.length, exposureQuerySkipped);

  return (
    <div className="container pagecontents">
      <PageHead
        breadcrumb={[
          { display: "Data Sources", href: "/datasources" },
          { display: d.name },
        ]}
      />

      {d.decryptionError && (
        <Callout
          status="error"
          mb="3"
          action={
            <DocLink docSection="env_prod" useRadix>
              View instructions for fixing
            </DocLink>
          }
        >
          <strong>Error Decrypting Data Source Credentials.</strong>
        </Callout>
      )}
      <Flex align="center" gap="3" wrap="wrap">
        <Heading as="h1" size="xl" overflowWrap="anywhere" mb="0">
          {d.name}
        </Heading>
        <Badge
          label={
            <>
              <PiLinkBold />
              Connected
            </>
          }
          color="green"
          variant="solid"
          radius="full"
        />
        <Flex align="center" gap="1">
          <ProjectBadges
            resourceType="data source"
            projectIds={d.projects?.length ? d.projects : undefined}
            skipMargin
          />
          {canUpdateDataSourceSettings && projects.length > 0 && (
            <Link
              aria-label="Edit Projects"
              onClick={(e) => {
                e.preventDefault();
                setEditProjectsOpen(true);
              }}
            >
              <GBEdit />
            </Link>
          )}
        </Flex>
      </Flex>
      {d.type === "mixpanel" && (
        <Callout status="warning" mt="3">
          Using Mixpanel as a direct data source is deprecated and no longer
          supported, because Mixpanel has placed their query language (JQL) in
          maintenance mode. To keep using Mixpanel data in GrowthBook, export it
          to a data warehouse (e.g. BigQuery or Snowflake) and connect that
          warehouse instead.{" "}
          <DocLink docSection="mixpanel">View migration guide</DocLink>
        </Callout>
      )}
      <Box mt="4" mb="4">
        {showFinishSettingUp && (
          <Frame px="0" py="0" style={{ overflow: "hidden" }}>
            <FinishSettingUp
              dataSource={d}
              factTableCount={factTables.length}
              canEdit={canUpdateDataSourceSettings}
              onSave={updateDataSourceSettings}
              exposureQuerySkipped={exposureQuerySkipped}
              onSkipExposureQuery={skipExposureQuery}
            />
          </Frame>
        )}

        {supportsSQL &&
          !isManagedWarehouse &&
          !newDataSourceOnboarding.enabled &&
          d.dateUpdated === d.dateCreated &&
          d.settings?.schemaFormat !== "custom" && (
            <Callout status="info" mb="4">
              We have prefilled the identifier types and assignment queries.
              These may require editing to fit your data structure.
            </Callout>
          )}

        {isManagedWarehouse &&
          (managedWarehouseAwaitingProvisioning ? (
            <ManagedWarehouseNoEventsCallout />
          ) : (
            <Frame>
              <Heading as="h2" size="md" mb="2">
                Sending Events
              </Heading>
              <Text>
                <DocLink useRadix={false} docSection="managedWarehouseTracking">
                  Read our full docs
                </DocLink>{" "}
                with instructions on how to send events from your app to
                GrowthBook.
              </Text>
            </Frame>
          ))}

        <Tabs defaultValue="overview" persistInURL>
          <TabsList size="lg">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="usage">Usage</TabsTrigger>
            {supportsSQL && (
              <>
                <TabsTrigger value="queries">Queries</TabsTrigger>
                <TabsTrigger value="explore">Explore</TabsTrigger>
              </>
            )}
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <Flex direction="column" gap="2" mt="3">
              {(d.description || canUpdateDataSourceSettings) && (
                <Frame mb="0">
                  <Heading as="h2" size="md">
                    Description
                  </Heading>
                  <DataSourceDescription
                    value={d.description || ""}
                    canEdit={canUpdateDataSourceSettings}
                    save={async (description) => {
                      await apiCall(`/datasource/${d.id}`, {
                        method: "PUT",
                        body: JSON.stringify({ description }),
                      });
                      await Promise.all([
                        mutateDefinitions({}),
                        mutateCurrentDataSource(),
                      ]);
                    }}
                  />
                </Frame>
              )}
              <Frame mb="0">
                <Heading as="h2" size="md" mb="3">
                  Connected Resources
                </Heading>
                <Flex direction={{ initial: "column", md: "row" }} gap="6">
                  <Box flexGrow="1" flexBasis="0">
                    <ResourceReferenceList
                      title="Fact Tables"
                      items={factTables.map((factTable) => ({
                        id: factTable.id,
                        name: factTable.name,
                        href: `/fact-tables/${factTable.id}`,
                      }))}
                      emptyText="No Fact Tables use this Data Source."
                    />
                  </Box>
                  <Box flexGrow="1" flexBasis="0">
                    <ResourceReferenceList
                      title="Metrics"
                      items={metrics.map((metric) => ({
                        id: metric.id,
                        name: metric.name,
                        href: `/metric/${metric.id}`,
                      }))}
                      emptyText="No metrics use this Data Source."
                    />
                  </Box>
                  <Box flexGrow="1" flexBasis="0">
                    <ResourceReferenceList
                      title="Experiments"
                      items={
                        experiments?.map((experiment) => ({
                          id: experiment.id,
                          name: experiment.name,
                          href: `/experiment/${experiment.id}`,
                        })) ?? null
                      }
                      emptyText="No experiments use this Data Source."
                    />
                  </Box>
                </Flex>
              </Frame>
            </Flex>
          </TabsContent>

          <TabsContent value="usage">
            <Flex direction="column" gap="2" mt="3">
              <Frame mb="0">
                <DataSourceUsage datasource={d} />
              </Frame>
            </Flex>
          </TabsContent>

          {supportsSQL && (
            <>
              <TabsContent value="queries">
                <Flex direction="column" gap="2" mt="3">
                  <Frame mb="0">
                    {isManagedWarehouse ? (
                      managedWarehouseAwaitingProvisioning ? (
                        <ManagedWarehouseNoEventsCallout />
                      ) : (
                        <ClickhouseManagedWarehouseIdentifiers
                          dataSource={d}
                          canEdit={canUpdateDataSourceSettings}
                          mutate={async () => {
                            await Promise.all([
                              mutateDefinitions({}),
                              mutateCurrentDataSource(),
                            ]);
                          }}
                        />
                      )
                    ) : (
                      <DataSourceInlineEditIdentifierTypes
                        onSave={updateDataSourceSettings}
                        onCancel={() => undefined}
                        dataSource={d}
                        canEdit={canUpdateDataSourceSettings}
                      />
                    )}
                  </Frame>
                  {!isManagedWarehouse && (
                    <Frame id={EAQ_ANCHOR_ID} mb="0">
                      <ExperimentAssignmentQueries
                        dataSource={d}
                        onSave={updateDataSourceSettings}
                        onCancel={() => undefined}
                        canEdit={!hasFileConfig()}
                      />
                    </Frame>
                  )}
                  {contextualBanditsEnabled &&
                    hasCommercialFeature("contextual-bandits") && (
                      <Frame id={CBAQ_ANCHOR_ID} mb="0">
                        <ContextualBanditAssignmentQueries
                          dataSource={d}
                          canEdit={canUpdateDataSourceSettings}
                        />
                      </Frame>
                    )}
                  {!isManagedWarehouse && (
                    <>
                      <Frame mb="0">
                        <FeatureEvaluationQueries
                          dataSource={d}
                          onSave={updateDataSourceSettings}
                          canEdit={canUpdateDataSourceSettings}
                        />
                      </Frame>
                      {d.settings?.userIdTypes &&
                      d.settings.userIdTypes.length > 1 ? (
                        <Frame mb="0">
                          <DataSourceInlineEditIdentityJoins
                            dataSource={d}
                            onSave={updateDataSourceSettings}
                            onCancel={() => undefined}
                            canEdit={canUpdateDataSourceSettings}
                          />
                        </Frame>
                      ) : null}
                      {d.settings.notebookRunQuery && (
                        <Frame mb="0">
                          <DataSourceJupyterNotebookQuery
                            dataSource={d}
                            onSave={updateDataSourceSettings}
                            onCancel={() => undefined}
                            canEdit={canUpdateDataSourceSettings}
                          />
                        </Frame>
                      )}
                    </>
                  )}
                </Flex>
              </TabsContent>

              <TabsContent value="explore">
                <Flex direction="column" gap="2" mt="3">
                  {d.properties?.supportsInformationSchema && (
                    <Callout status="info">
                      Want to explore even further? Use the{" "}
                      <Link onClick={() => setViewSqlExplorer(true)}>
                        SQL Explorer
                      </Link>{" "}
                      for advanced exploration.
                    </Callout>
                  )}
                  <Explorer
                    type="data_source"
                    datasourceId={d.id}
                    lockDatasource
                    height="calc(100vh - 280px)"
                  />
                </Flex>
              </TabsContent>
            </>
          )}

          <TabsContent value="settings">
            <Flex direction="column" gap="2" mt="3">
              <Frame mb="0">
                <Flex align="center" justify="between" gap="3" mb="3">
                  <Heading as="h2" size="md" mb="0">
                    General Settings
                  </Heading>
                  {canUpdateConnectionParams &&
                    (newDataSourceOnboarding.enabled ? (
                      <LinkButton
                        href={`/datasources/${d.id}/connect`}
                        variant="outline"
                      >
                        Edit connection
                      </LinkButton>
                    ) : (
                      <Button
                        variant="outline"
                        onClick={() => setEditConn(true)}
                      >
                        Edit connection
                      </Button>
                    ))}
                </Flex>
                <Flex direction="column" gap="3" maxWidth="600px">
                  <Flex align="end" gap="2">
                    <TextField
                      label="Name"
                      value={dataSourceName}
                      error={dataSourceNameError ?? undefined}
                      onChange={(event) => {
                        setDataSourceName(event.target.value);
                        setDataSourceNameError(null);
                      }}
                      disabled={!canUpdateDataSourceSettings}
                      style={{ flexGrow: 1 }}
                    />
                    {canUpdateDataSourceSettings && (
                      <Button
                        loading={savingDataSourceName}
                        disabled={
                          !dataSourceName.trim() ||
                          dataSourceName.trim() === d.name
                        }
                        onClick={saveDataSourceName}
                      >
                        Save
                      </Button>
                    )}
                  </Flex>
                  <DataList
                    data={[
                      {
                        label: "Type",
                        value:
                          d.type === "growthbook_clickhouse"
                            ? "Managed Warehouse"
                            : d.type,
                      },
                      ...(isManagedWarehouse
                        ? [
                            {
                              label: "Region",
                              value: getDataRegionLabel(
                                d.settings.region ?? DEFAULT_DATA_REGION,
                              ),
                            },
                          ]
                        : []),
                      ...connectionDetails,
                      {
                        label: "Last updated",
                        value: datetime(d.dateUpdated ?? ""),
                      },
                    ]}
                  />
                  {supportsSQL && orgSettings?.aiAskDataEnabled && (
                    <AskDataSettings
                      dataSource={d}
                      onSave={updateDataSourceSettings}
                      canEdit={canUpdateDataSourceSettings}
                    />
                  )}
                </Flex>
              </Frame>

              {datasourceSupportsEventForwarder &&
                eventsForwarderFlag !== "OFF" && (
                  <Frame mb="0">
                    <EventForwarder
                      dataSource={d}
                      canEdit={canUpdateDataSourceSettings}
                      onRefresh={async () => {
                        await Promise.all([
                          mutateDefinitions({}),
                          mutateCurrentDataSource(),
                        ]);
                      }}
                    />
                  </Frame>
                )}

              {supportsEvents && (
                <Frame mb="0">
                  <DataSourceViewEditExperimentProperties
                    dataSource={d}
                    onSave={updateDataSourceSettings}
                    onCancel={() => undefined}
                    canEdit={canUpdateDataSourceSettings}
                  />
                </Frame>
              )}

              {d.type === "mixpanel" && (
                <Frame mb="0">
                  <MixpanelTrackingInstructions dataSource={d} />
                </Frame>
              )}

              {d.properties?.supportsWritingTables && pipelineEnabled && (
                <Frame mb="0">
                  <DataSourcePipeline
                    dataSource={d}
                    onSave={updateDataSourceSettings}
                    onCancel={() => undefined}
                    canEdit={canUpdateDataSourceSettings}
                  />
                </Frame>
              )}

              {!d.properties?.hasSettings && (
                <Callout status="info">
                  This Data Source does not require any additional
                  configuration.
                </Callout>
              )}

              <Frame mb="0">
                <Heading as="h2" size="md" mb="3">
                  Change Log
                </Heading>
                <HistoryTable type="datasource" id={d.id} />
              </Frame>

              {canDelete && (
                <Frame mb="0">
                  <Flex align="center" justify="between" gap="3" wrap="wrap">
                    <Box>
                      <Heading as="h2" size="md" mb="1">
                        Delete Data Source
                      </Heading>
                      <Text color="text-mid">
                        Experiments and metrics that use it will stop updating.
                      </Text>
                    </Box>
                    <Button
                      variant="outline"
                      color="red"
                      onClick={() => {
                        if (deleteBlockedByEventForwarder) {
                          setDeleteBlockedByEventForwarderModalOpen(true);
                        } else {
                          setConfirmDelete(true);
                        }
                      }}
                    >
                      Delete
                    </Button>
                  </Flex>
                </Frame>
              )}
            </Flex>
          </TabsContent>
        </Tabs>
      </Box>
      {editProjectsOpen && (
        <EditProjectsForm
          label={<>Projects</>}
          cancel={() => setEditProjectsOpen(false)}
          entityName="Data Source"
          mutate={() => {
            mutateDefinitions({});
            mutateCurrentDataSource();
          }}
          value={d.projects || []}
          permissionRequired={(project) =>
            permissionsUtil.canUpdateDataSourceSettings({
              projects: [project],
            })
          }
          save={async (projects) => {
            await apiCall(`/datasource/${d.id}`, {
              method: "PUT",
              body: JSON.stringify({
                projects,
              }),
            });
          }}
        />
      )}
      {editConn && (
        <DataSourceForm
          existing={true}
          data={d}
          source={"datasource-detail"}
          onSuccess={async () => {
            await Promise.all([
              mutateDefinitions({}),
              mutateCurrentDataSource(),
            ]);
          }}
          onCancel={() => {
            setEditConn(false);
          }}
        />
      )}
      {viewSqlExplorer && (
        <SqlExplorerModal
          initial={{ datasourceId: d.id }}
          close={() => setViewSqlExplorer(false)}
          mutate={mutateDefinitions}
          disableSave={true}
          header="SQL Explorer"
          lockDatasource={true}
          trackingEventModalSource="datasource-id-page"
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title={`Delete "${d.name}"`}
          content="Experiments and metrics that use it will stop updating."
          yesText="Delete"
          color="red"
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => {
            await apiCall(`/datasource/${d.id}`, {
              method: "DELETE",
            });
            mutateDefinitions({});
            router.push("/datasources");
          }}
        />
      )}
      {deleteBlockedByEventForwarderModalOpen && (
        <ModalStandard
          trackingEventModalType=""
          open={true}
          header={`Cannot delete "${d.name}"`}
          close={() => setDeleteBlockedByEventForwarderModalOpen(false)}
        >
          <Text>
            Please contact your account manager to remove the Event Forwarder
            first; after that, you can delete this data source here.
          </Text>
        </ModalStandard>
      )}
    </div>
  );
};
export default DataSourcePage;

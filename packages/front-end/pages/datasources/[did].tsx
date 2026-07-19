import { useRouter } from "next/router";
import { FC, useCallback, useState } from "react";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import {
  isManagedWarehouseAwaitingProvisioning,
  supportsEventForwarder,
} from "shared/util";
import { isSampleDatasource } from "shared/demo-datasource";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { BsThreeDotsVertical } from "react-icons/bs";
import { PiLinkBold } from "react-icons/pi";
import { datetime } from "shared/dates";
import { useFeatureIsOn, useFeatureValue } from "@growthbook/growthbook-react";
import ManagedWarehouseNoEventsCallout from "@/components/ManagedWarehouse/ManagedWarehouseNoEventsCallout";
import Link from "@/ui/Link";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { hasFileConfig } from "@/services/env";
import { DocLink, DocSection } from "@/components/DocLink";
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
import { useUser } from "@/services/UserContext";
import PageHead from "@/components/Layout/PageHead";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Badge from "@/ui/Badge";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/DropdownMenu";
import Callout from "@/ui/Callout";
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

function quotePropertyName(name: string) {
  if (name.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/)) {
    return name;
  }
  return JSON.stringify(name);
}

export const EAQ_ANCHOR_ID = "experiment-assignment-queries";
export const CBAQ_ANCHOR_ID = "contextual-bandit-assignment-queries";

const DataSourcePage: FC = () => {
  const permissionsUtil = usePermissionsUtil();
  const [editConn, setEditConn] = useState(false);
  const [viewSqlExplorer, setViewSqlExplorer] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [auditModal, setAuditModal] = useState(false);
  const [
    deleteBlockedByEventForwarderModalOpen,
    setDeleteBlockedByEventForwarderModalOpen,
  ] = useState(false);
  const router = useRouter();

  const {
    getDatasourceById,
    getProjectById,
    mutateDefinitions,
    ready,
    error,
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

  const { apiCall, orgId } = useAuth();
  const { hasCommercialFeature } = useUser();
  const contextualBanditsEnabled = useFeatureIsOn("contextual-bandits");

  const isManagedWarehouse = d?.type === "growthbook_clickhouse";
  // Only the never-provisioned state replaces the settings UI with the onboarding
  // callout. A transient migration must NOT blank the config page — query sub-surfaces
  // (SQL explorer, schema browser) gate themselves on the broader "unavailable" check.
  const managedWarehouseAwaitingProvisioning = d
    ? isManagedWarehouseAwaitingProvisioning(d)
    : false;

  const queryString = new URLSearchParams(
    `q=datasource:"${d?.name}"`,
  ).toString();

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
  const supportsEvents = d.properties?.events || false;
  const datasourceSupportsEventForwarder = supportsEventForwarder(d);

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
      <Flex align="center" justify="between">
        <Flex align="center" gap="3">
          <Heading as="h1" size="x-large" mb="0">
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
        </Flex>
        {(canUpdateConnectionParams ||
          canUpdateDataSourceSettings ||
          canDelete) && (
          <Flex align="center" pr="2">
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
              open={dropdownOpen}
              onOpenChange={setDropdownOpen}
            >
              {canUpdateConnectionParams && (
                <DropdownMenuItem
                  onClick={() => {
                    setEditConn(true);
                    setDropdownOpen(false);
                  }}
                >
                  Edit Connection Info
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={() => {
                  setAuditModal(true);
                  setDropdownOpen(false);
                }}
              >
                Audit log
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  // DocLink usually navigates externally; close the dropdown first.
                  setDropdownOpen(false);
                }}
              >
                <DocLink
                  useRadix={false}
                  docSection={d.type as DocSection}
                  fallBackSection="datasources"
                >
                  View Documentation
                </DocLink>
              </DropdownMenuItem>
              {d?.properties?.supportsInformationSchema && (
                <DropdownMenuItem
                  onClick={() => {
                    setViewSqlExplorer(true);
                    setDropdownOpen(false);
                  }}
                >
                  View SQL Explorer
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={() => {
                  setDropdownOpen(false);
                  router.push(`/datasources/queries/${did}`);
                }}
              >
                View Queries
              </DropdownMenuItem>
              {canDelete && (
                <>
                  <DropdownMenuSeparator />
                  {deleteBlockedByEventForwarder ? (
                    <DropdownMenuItem
                      color="red"
                      onClick={() => {
                        setDeleteBlockedByEventForwarderModalOpen(true);
                        setDropdownOpen(false);
                      }}
                    >
                      Delete
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      color="red"
                      confirmation={{
                        confirmationTitle: `Delete "${d.name}" Datasource`,
                        cta: "Delete",
                        submit: async () => {
                          await apiCall(`/datasource/${d.id}`, {
                            method: "DELETE",
                          });
                          mutateDefinitions({});
                          router.push("/datasources");
                        },
                        closeDropdown: () => setDropdownOpen(false),
                      }}
                    >
                      Delete
                    </DropdownMenuItem>
                  )}
                </>
              )}
            </DropdownMenu>
          </Flex>
        )}
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
      <Flex align="center" gap="4" my="2">
        <Text color="text-mid">
          <Text weight="medium">Type:</Text>{" "}
          {d.type === "growthbook_clickhouse" ? "managed" : d.type}
        </Text>
        <Box>
          <Text color="text-mid" weight="medium">
            Fact Tables:
          </Text>{" "}
          <Link href={`/fact-tables?${queryString}`}>
            {factTables.length > 0 ? factTables.length : "+Add"}
          </Link>
        </Box>
        <Box>
          <Text color="text-mid" weight="medium">
            Metrics:{" "}
          </Text>
          {metrics.length > 0 ? (
            <Link href={`/metrics?${queryString}`}>{metrics.length}</Link>
          ) : (
            <Text color="text-mid">None</Text>
          )}
        </Box>
        <Text color="text-mid">
          <Text weight="medium">Last Updated:</Text>{" "}
          {datetime(d.dateUpdated ?? "")}
        </Text>
        <Box>
          <Text color="text-mid" weight="medium">
            Projects:{" "}
          </Text>
          {d?.projects?.length ? (
            <Text color="text-mid">
              {d.projects.map((p) => getProjectById(p)?.name || p).join(", ")}
            </Text>
          ) : (
            <Text color="text-mid" fontStyle="italic">
              All Projects
            </Text>
          )}
        </Box>
      </Flex>
      {d.description && (
        <Box mb="3">
          <Text color="text-mid">{d.description}</Text>
        </Box>
      )}

      {!d.properties?.hasSettings && (
        <Box mt="3">
          <Callout status="info">
            This data source does not require any additional configuration.
          </Callout>
        </Box>
      )}
      <Box mt="4" mb="4">
        {supportsEvents && (
          <>
            <div className="my-5">
              <DataSourceViewEditExperimentProperties
                dataSource={d}
                onSave={updateDataSourceSettings}
                onCancel={() => undefined}
                canEdit={canUpdateDataSourceSettings}
              />
            </div>

            {d.type === "mixpanel" && (
              <div>
                <Heading size="small" as="h3" mb="1">
                  Mixpanel Tracking Instructions
                </Heading>
                <p>
                  This example is for Javascript and uses the above settings.
                  Other languages should be similar.
                </p>
                <Code
                  language="javascript"
                  code={`
// Tracking Callback for GrowthBook SDK
const growthbook = new GrowthBook({
  ...,
  trackingCallback: function(experiment, result) {
    mixpanel.track(${JSON.stringify(
      d.settings?.events?.experimentEvent || "$experiment_started",
    )}, {
      ${quotePropertyName(
        d.settings?.events?.experimentIdProperty || "Experiment name",
      )}: experiment.key,
      ${quotePropertyName(
        d.settings?.events?.variationIdProperty || "Variant name",
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
              </div>
            )}
          </>
        )}
        {supportsSQL && (
          <>
            {isManagedWarehouse ? (
              managedWarehouseAwaitingProvisioning ? (
                <ManagedWarehouseNoEventsCallout />
              ) : (
                <>
                  <Frame>
                    <Heading as="h3" size="medium" mb="2">
                      Sending Events
                    </Heading>
                    <Text>
                      <DocLink
                        useRadix={false}
                        docSection="managedWarehouseTracking"
                      >
                        Read our full docs
                      </DocLink>{" "}
                      with instructions on how to send events from your app to
                      GrowthBook.
                    </Text>
                  </Frame>
                  <Frame>
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
                  </Frame>
                </>
              )
            ) : (
              <>
                {datasourceSupportsEventForwarder &&
                  eventsForwarderFlag !== "OFF" && (
                    <Frame>
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

                {d.dateUpdated === d.dateCreated &&
                  d?.settings?.schemaFormat !== "custom" && (
                    <Callout status="info" mt="4" mb="4">
                      We have prefilled the identifiers and assignment queries
                      below. These queries may require editing to fit your data
                      structure.
                    </Callout>
                  )}

                <Frame>
                  <DataSourceInlineEditIdentifierTypes
                    onSave={updateDataSourceSettings}
                    onCancel={() => undefined}
                    dataSource={d}
                    canEdit={canUpdateDataSourceSettings}
                  />
                </Frame>

                <Frame id={EAQ_ANCHOR_ID}>
                  <ExperimentAssignmentQueries
                    dataSource={d}
                    onSave={updateDataSourceSettings}
                    onCancel={() => undefined}
                    canEdit={canUpdateDataSourceSettings}
                  />
                </Frame>

                {contextualBanditsEnabled &&
                  hasCommercialFeature("contextual-bandits") && (
                    <Frame id={CBAQ_ANCHOR_ID}>
                      <ContextualBanditAssignmentQueries
                        dataSource={d}
                        canEdit={canUpdateDataSourceSettings}
                      />
                    </Frame>
                  )}

                {d.settings?.userIdTypes &&
                d.settings.userIdTypes.length > 1 ? (
                  <Frame>
                    <DataSourceInlineEditIdentityJoins
                      dataSource={d}
                      onSave={updateDataSourceSettings}
                      onCancel={() => undefined}
                      canEdit={canUpdateDataSourceSettings}
                    />
                  </Frame>
                ) : null}

                <Frame>
                  <FeatureEvaluationQueries
                    dataSource={d}
                    onSave={updateDataSourceSettings}
                    canEdit={canUpdateDataSourceSettings}
                  />
                </Frame>

                {d.settings.notebookRunQuery && (
                  <Frame>
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

            {d.properties?.supportsWritingTables && pipelineEnabled ? (
              <Frame>
                <DataSourcePipeline
                  dataSource={d}
                  onSave={updateDataSourceSettings}
                  onCancel={() => undefined}
                  canEdit={canUpdateDataSourceSettings}
                />
              </Frame>
            ) : null}
          </>
        )}
      </Box>
      <div className="row">
        <div className="col-md-12"></div>
      </div>

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
      {auditModal && (
        <ModalStandard
          trackingEventModalType=""
          open={true}
          header="Audit Log"
          close={() => setAuditModal(false)}
          size="lg"
        >
          <HistoryTable type={"datasource"} id={d.id} />
        </ModalStandard>
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

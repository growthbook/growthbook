import { useRouter } from "next/router";
import {
  FC,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
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
import { useDefinitions } from "@/services/DefinitionsContext";
import { hasFileConfig, isCloud } from "@/services/env";
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
import { dataSourceConnections } from "@/services/eventSchema";
import {
  getDataRegionLabel,
  DEFAULT_DATA_REGION,
} from "@/services/dataRegions";
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
import { useCombinedMetrics } from "@/components/Metrics/MetricsList";
import { FeatureEvaluationQueries } from "@/components/Settings/EditDataSource/FeatureEvaluationQueries/FeatureEvaluationQueries";
import Heading from "@/ui/Heading";
import Metadata from "@/ui/Metadata";
import Text from "@/ui/Text";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import HistoryTable from "@/components/HistoryTable";
import EventForwarder from "@/components/Settings/EditDataSource/EventForwarder/EventForwarder";
import EditProjectsForm from "@/components/Projects/EditProjectsForm";
import { GBEdit } from "@/components/Icons";
import ConnectedResources from "@/components/Settings/EditDataSource/ConnectedResources";
import DataSourceDescriptionSection from "@/components/Settings/EditDataSource/DataSourceDescriptionSection";
import LinkButton from "@/ui/LinkButton";
import Button from "@/ui/Button";
import Explorer from "@/enterprise/components/ProductAnalytics/Explorer";
import TextField from "@/ui/TextField";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import { DataSourceUsage } from "@/pages/datasources/queries/[did]";
import useURLHash from "@/hooks/useURLHash";

export const EAQ_ANCHOR_ID = "experiment-assignment-queries";
export const CBAQ_ANCHOR_ID = "contextual-bandit-assignment-queries";

// Default when this Data Source has no Event Forwarder tab. Queries is only
// rendered for SQL sources; non-SQL sources fall back to Usage.
const DATA_SOURCE_TABS = [
  "queries",
  "usage",
  "resources",
  "explore",
  "settings",
] as const;

type DataSourceTab = (typeof DATA_SOURCE_TABS)[number] | "event-forwarder";

// Used when Finish Setting Up is on the page, so Explore stays a normal
// scrolling section instead of a viewport-locked panel.
const EXPLORER_HEIGHT_WHEN_PAGE_SCROLLS = "max(480px, calc(100vh - 280px))";

// Pre-tabs deep links (e.g. the Dimensions page's "Manage via Data Source"
// link) point at anchors inside the Queries tab, not a DATA_SOURCE_TABS id.
const LEGACY_ANCHOR_TABS: Record<string, (typeof DATA_SOURCE_TABS)[number]> = {
  [EAQ_ANCHOR_ID]: "queries",
  [CBAQ_ANCHOR_ID]: "queries",
};

function quotePropertyName(name: string) {
  if (name.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/)) {
    return name;
  }
  return JSON.stringify(name);
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

function DataSourceDescriptionPreview({
  description,
  onViewFull,
}: {
  description: string;
  onViewFull: () => void;
}) {
  const textRef = useRef<HTMLDivElement>(null);
  const [truncated, setTruncated] = useState(false);

  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const check = () => setTruncated(el.scrollWidth > el.clientWidth + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [description]);

  return (
    <Flex
      align="center"
      gap="2"
      wrap="nowrap"
      minWidth="0"
      width="100%"
      style={{ maxWidth: 640 }}
    >
      <Box minWidth="0" flexGrow="1">
        <Text ref={textRef} as="div" size="sm" color="text-mid" truncate>
          {description}
        </Text>
      </Box>
      {truncated ? (
        <Link size="sm" style={{ flexShrink: 0 }} onClick={onViewFull}>
          View full description
        </Link>
      ) : null}
    </Flex>
  );
}

const DataSourcePage: FC = () => {
  const permissionsUtil = usePermissionsUtil();
  const newDataSourceOnboarding = useNewDataSourceOnboarding();
  const [editConn, setEditConn] = useState(false);
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
  const pageRef = useRef<HTMLDivElement>(null);
  const explorerSlotRef = useRef<HTMLDivElement>(null);
  const [pageHeight, setPageHeight] = useState<number | null>(null);
  const [explorerHeight, setExplorerHeight] = useState<number | null>(null);

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

  // Event Forwarder is first so an empty hash opens it when this Data Source
  // has one.
  const showEventForwarderTab = Boolean(
    newDataSourceOnboarding.enabled &&
      d?.eventForwarderConfig &&
      d.eventForwarderConfig.status !== "unconfigured",
  );
  const tabIds: readonly DataSourceTab[] = showEventForwarderTab
    ? ["event-forwarder", ...DATA_SOURCE_TABS]
    : DATA_SOURCE_TABS;
  const [tab, setTab] = useURLHash();
  // A full page load renders on the server, where the hash is invisible, so
  // read it once here. Legacy anchors are not tab ids; open Queries and
  // scroll to them.
  const [pendingAnchor, setPendingAnchor] = useState<string | null>(null);
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    const legacyTab = LEGACY_ANCHOR_TABS[hash];
    if (legacyTab) {
      setPendingAnchor(hash);
      setTab(legacyTab);
      return;
    }
    if (
      (DATA_SOURCE_TABS as readonly string[]).includes(hash) ||
      hash === "event-forwarder"
    ) {
      setTab(hash);
    }
    // Only ever relevant for the hash the page loaded with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!pendingAnchor || tab !== "queries") return;
    const el = document.getElementById(pendingAnchor);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      setPendingAnchor(null);
    }
  }, [pendingAnchor, tab]);

  const combinedMetrics = useCombinedMetrics({});
  const metrics = combinedMetrics.filter((m) => m.datasource === did);
  const factTables = allFactTables.filter((ft) => ft.datasource === did);
  const { data: experimentsData, error: experimentsError } = useApi<{
    experiments: ExperimentInterfaceStringDates[];
  }>(
    `/experiments?datasourceId=${encodeURIComponent(did || "")}&includeArchived=true`,
    {
      shouldRun: () => !!did && tab === "resources",
    },
  );
  const experiments = experimentsData?.experiments ?? null;
  const experimentsLoadError =
    !experimentsData && experimentsError
      ? experimentsError.message || "Could not load experiments."
      : undefined;
  const { skipped: exposureQuerySkipped, skip: skipExposureQuery } =
    useExposureQuerySkipped(did);

  useEffect(() => {
    setDataSourceName(d?.name ?? "");
    setDataSourceNameError(null);
  }, [d?.name]);

  const isManagedWarehouse = d?.type === "growthbook_clickhouse";
  const showFinishSettingUp =
    !!d &&
    d.properties?.queryLanguage === "sql" &&
    !isManagedWarehouse &&
    newDataSourceOnboarding.enabled &&
    !isDataSourceSetupComplete(d, factTables.length, exposureQuerySkipped);

  // Stretch the page to the bottom of the viewport, then give the explorer the
  // pixel height of the slot that remains under the header and tabs. Skip this
  // while Finish Setting Up is showing: that section sits above the tabs, and
  // locking the page to the viewport leaves it with nowhere to scroll.
  useLayoutEffect(() => {
    if (tab !== "explore" || showFinishSettingUp) return;
    const page = pageRef.current;
    const slot = explorerSlotRef.current;
    if (!page || !slot) return;

    const update = () => {
      const nextPageHeight = Math.max(
        480,
        Math.floor(
          document.documentElement.clientHeight -
            page.getBoundingClientRect().top,
        ),
      );
      setPageHeight((current) =>
        current !== null && Math.abs(current - nextPageHeight) < 2
          ? current
          : nextPageHeight,
      );

      const nextExplorerHeight = Math.floor(
        slot.getBoundingClientRect().height,
      );
      if (nextExplorerHeight < 200) return;
      setExplorerHeight((current) =>
        current !== null && Math.abs(current - nextExplorerHeight) < 2
          ? current
          : nextExplorerHeight,
      );
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(page);
    observer.observe(slot);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [tab, d?.id, ready, showFinishSettingUp]);

  const { apiCall, orgId } = useAuth();
  const { hasCommercialFeature, settings: orgSettings } = useUser();
  // Default ON; the remote flag only turns this off for specific orgs.
  const contextualBanditsEnabled = useFeatureValue("contextual-bandits", true);

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

  const saveDataSourceDescription = useCallback(
    async (description: string) => {
      if (!d) return;
      await apiCall(`/datasource/${d.id}`, {
        method: "PUT",
        body: JSON.stringify({ description }),
      });
      await Promise.all([mutateDefinitions({}), mutateCurrentDataSource()]);
    },
    [apiCall, d, mutateCurrentDataSource, mutateDefinitions],
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
  const dataSourceTypeLabel = isManagedWarehouse
    ? "Managed Warehouse"
    : (dataSourceConnections.find((c) => c.type === d.type)?.display ?? d.type);
  const hashTab: DataSourceTab =
    tab && (tabIds as readonly string[]).includes(tab)
      ? (tab as DataSourceTab)
      : tabIds[0];
  const activeTab: DataSourceTab =
    !supportsSQL && (hashTab === "queries" || hashTab === "explore")
      ? "usage"
      : hashTab;
  const exploreFillsViewport = activeTab === "explore" && !showFinishSettingUp;
  const supportsEvents = d.properties?.events || false;
  // The tab is the Event Forwarder surface for the new setup. Unconfigured
  // forwarders keep the card in Settings.
  const showEventForwarderSettings =
    !showEventForwarderTab && supportsEventForwarder(d) && isCloud();
  const refreshDataSource = async () => {
    await Promise.all([mutateDefinitions({}), mutateCurrentDataSource()]);
  };

  return (
    <div
      ref={pageRef}
      className="container pagecontents"
      style={
        exploreFillsViewport
          ? {
              display: "flex",
              flexDirection: "column",
              height: pageHeight ?? "calc(100vh - 56px)",
              overflow: "hidden",
              boxSizing: "border-box",
            }
          : undefined
      }
    >
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
      <Flex direction="column" gap="1" minWidth="0" width="100%">
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
        {d.description ? (
          <DataSourceDescriptionPreview
            description={d.description}
            onViewFull={() => setTab("settings")}
          />
        ) : null}
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
      <Box
        mt="4"
        mb={exploreFillsViewport ? "0" : "4"}
        style={
          exploreFillsViewport
            ? {
                flex: 1,
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
              }
            : undefined
        }
      >
        {showFinishSettingUp && (
          <Frame px="0" py="0" style={{ overflow: "hidden" }}>
            <FinishSettingUp
              dataSource={d}
              factTableCount={factTables.length}
              canEdit={canUpdateDataSourceSettings}
              onSave={updateDataSourceSettings}
              exposureQuerySkipped={exposureQuerySkipped}
              onSkipExposureQuery={skipExposureQuery}
              onRefresh={async () => {
                await Promise.all([
                  mutateDefinitions({}),
                  mutateCurrentDataSource(),
                ]);
              }}
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

        <Tabs
          value={activeTab}
          onValueChange={(value) => {
            if ((tabIds as readonly string[]).includes(value)) {
              setTab(value as DataSourceTab);
            }
          }}
          style={
            exploreFillsViewport
              ? {
                  flex: 1,
                  minHeight: 0,
                  display: "flex",
                  flexDirection: "column",
                }
              : undefined
          }
        >
          <TabsList
            size="lg"
            style={exploreFillsViewport ? { flexShrink: 0 } : undefined}
          >
            {showEventForwarderTab ? (
              <TabsTrigger value="event-forwarder">Event Forwarder</TabsTrigger>
            ) : null}
            {supportsSQL && <TabsTrigger value="queries">Queries</TabsTrigger>}
            <TabsTrigger value="usage">Usage</TabsTrigger>
            <TabsTrigger value="resources">Connected Resources</TabsTrigger>
            {supportsSQL && <TabsTrigger value="explore">Explore</TabsTrigger>}
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>

          {showEventForwarderTab ? (
            <TabsContent value="event-forwarder">
              <Flex direction="column" gap="2" mt="3">
                <Frame mb="0">
                  <EventForwarder
                    dataSource={d}
                    canEdit={canUpdateDataSourceSettings}
                    onRefresh={refreshDataSource}
                  />
                </Frame>
              </Flex>
            </TabsContent>
          ) : null}

          <TabsContent value="usage">
            <Flex direction="column" gap="2" mt="3">
              <Frame mb="0">
                <DataSourceUsage datasource={d} />
              </Frame>
            </Flex>
          </TabsContent>

          <TabsContent value="resources">
            <Box mt="3">
              <ConnectedResources
                factTables={factTables.map((factTable) => ({
                  id: factTable.id,
                  name: factTable.name,
                  projects: factTable.projects || [],
                }))}
                metrics={metrics.map((metric) => ({
                  id: metric.id,
                  name: metric.name,
                }))}
                experiments={experiments}
                experimentsError={experimentsLoadError}
              />
            </Box>
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

              <TabsContent
                value="explore"
                style={
                  exploreFillsViewport
                    ? {
                        flex: 1,
                        minHeight: 0,
                        display: "flex",
                        flexDirection: "column",
                      }
                    : undefined
                }
              >
                <Flex
                  direction="column"
                  gap="3"
                  mt={exploreFillsViewport ? "0" : "3"}
                  style={
                    exploreFillsViewport ? { flex: 1, minHeight: 0 } : undefined
                  }
                >
                  {d.properties?.supportsInformationSchema && (
                    <Callout
                      status="info"
                      dismissible
                      id="datasource-explore-sql-explorer"
                      style={{ flexShrink: 0 }}
                    >
                      Want to explore even further? Use the{" "}
                      <Link
                        href={`/product-analytics/explore/sql?datasourceId=${d.id}`}
                      >
                        SQL Explorer
                      </Link>{" "}
                      for advanced exploration.
                    </Callout>
                  )}
                  <Box
                    ref={explorerSlotRef}
                    style={
                      exploreFillsViewport
                        ? { flex: "1 1 0", minHeight: 0, overflow: "hidden" }
                        : undefined
                    }
                  >
                    <Explorer
                      type="data_source"
                      datasourceId={d.id}
                      lockDatasource
                      height={
                        exploreFillsViewport
                          ? explorerHeight !== null
                            ? `${explorerHeight}px`
                            : "100%"
                          : EXPLORER_HEIGHT_WHEN_PAGE_SCROLLS
                      }
                    />
                  </Box>
                </Flex>
              </TabsContent>
            </>
          )}

          <TabsContent value="settings">
            <Flex direction="column" gap="2" mt="3">
              <Frame mb="0">
                <Flex align="end" justify="between" wrap="wrap" gap="3">
                  <Flex
                    align="end"
                    gap="2"
                    maxWidth="460px"
                    style={{ flex: "1 1 320px" }}
                  >
                    <Box flexGrow="1" minWidth="0">
                      <TextField
                        label="Name"
                        value={dataSourceName}
                        error={dataSourceNameError ?? undefined}
                        onChange={(event) => {
                          setDataSourceName(event.target.value);
                          setDataSourceNameError(null);
                        }}
                        disabled={!canUpdateDataSourceSettings}
                        style={{ width: "100%" }}
                      />
                    </Box>
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
                  <Flex
                    align="center"
                    gap="4"
                    wrap="wrap"
                    style={{ flexShrink: 0 }}
                  >
                    <Metadata
                      label="Type"
                      value={dataSourceTypeLabel}
                      size="sm"
                    />
                    {isManagedWarehouse ? (
                      <Metadata
                        label="Region"
                        value={getDataRegionLabel(
                          d.settings.region ?? DEFAULT_DATA_REGION,
                        )}
                        size="sm"
                      />
                    ) : null}
                    <Metadata
                      label="Last updated"
                      value={datetime(d.dateUpdated ?? "")}
                      size="sm"
                    />
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
                </Flex>
                <DataSourceDescriptionSection
                  description={d.description || ""}
                  canEdit={canUpdateDataSourceSettings}
                  save={saveDataSourceDescription}
                />
              </Frame>

              {supportsSQL && orgSettings?.aiAskDataEnabled && (
                <Frame mb="0">
                  <AskDataSettings
                    dataSource={d}
                    onSave={updateDataSourceSettings}
                    canEdit={canUpdateDataSourceSettings}
                  />
                </Frame>
              )}

              {showEventForwarderSettings ? (
                <Frame mb="0">
                  <EventForwarder
                    dataSource={d}
                    canEdit={canUpdateDataSourceSettings}
                    onRefresh={refreshDataSource}
                  />
                </Frame>
              ) : null}

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
                <HistoryTable type="datasource" id={d.id} maxHeight="420px" />
              </Frame>

              {canDelete && (
                <Frame mb="0">
                  <Flex align="center" justify="between" gap="3" wrap="wrap">
                    <Box>
                      <Heading as="h3" size="md" mb="1">
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

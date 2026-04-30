import { useRouter } from "next/router";
import React, { FC, useCallback, useState } from "react";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import { Box, Flex, IconButton } from "@radix-ui/themes";
import { BsThreeDotsVertical } from "react-icons/bs";
import { PiLinkBold } from "react-icons/pi";
import { datetime } from "shared/dates";
import Link from "@/ui/Link";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { hasFileConfig } from "@/services/env";
import { DocLink, DocSection } from "@/components/DocLink";
import { DataSourceInlineEditIdentifierTypes } from "@/components/Settings/EditDataSource/DataSourceInlineEditIdentifierTypes/DataSourceInlineEditIdentifierTypes";
import { DataSourceInlineEditIdentityJoins } from "@/components/Settings/EditDataSource/DataSourceInlineEditIdentityJoins/DataSourceInlineEditIdentityJoins";
import { ExperimentAssignmentQueries } from "@/components/Settings/EditDataSource/ExperimentAssignmentQueries/ExperimentAssignmentQueries";
import { DataSourceViewEditExperimentProperties } from "@/components/Settings/EditDataSource/DataSourceExperimentProperties/DataSourceViewEditExperimentProperties";
import { DataSourceJupyterNotebookQuery } from "@/components/Settings/EditDataSource/DataSourceJupypterQuery/DataSourceJupyterNotebookQuery";
import DataSourceForm from "@/components/Settings/DataSourceForm";
import Code from "@/components/SyntaxHighlighting/Code";
import LoadingOverlay from "@/components/LoadingOverlay";
import DataSourcePipeline from "@/components/Settings/EditDataSource/DataSourcePipeline/DataSourcePipeline";
import { DeleteDemoDatasourceButton } from "@/components/DemoDataSourcePage/DemoDataSourcePage";
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
import ClickhouseMaterializedColumns from "@/components/Settings/EditDataSource/ClickhouseMaterializedColumns";
import SqlExplorerModal from "@/components/SchemaBrowser/SqlExplorerModal";
import { useCombinedMetrics } from "@/components/Metrics/MetricsList";
import { FeatureEvaluationQueries } from "@/components/Settings/EditDataSource/FeatureEvaluationQueries/FeatureEvaluationQueries";
import Heading from "@/ui/Heading";
import Text from "@/ui/Text";

function quotePropertyName(name: string) {
  if (name.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/)) {
    return name;
  }
  return JSON.stringify(name);
}

export const EAQ_ANCHOR_ID = "experiment-assignment-queries";

const DataSourcePage: FC = () => {
  const permissionsUtil = usePermissionsUtil();
  const [editConn, setEditConn] = useState(false);
  const [viewSqlExplorer, setViewSqlExplorer] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
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
  const d = getDatasourceById(did);

  const combinedMetrics = useCombinedMetrics({});
  const metrics = combinedMetrics.filter((m) => m.datasource === did);
  const factTables = allFactTables.filter((ft) => ft.datasource === did);

  const { apiCall } = useAuth();
  const { organization, hasCommercialFeature } = useUser();

  const isManagedWarehouse = d?.type === "growthbook_clickhouse";

  const queryString = new URLSearchParams(
    `q=datasource:"${d?.name}"`,
  ).toString();

  const canDelete =
    (d && permissionsUtil.canDeleteDataSource(d) && !hasFileConfig()) || false;

  const canUpdateConnectionParams =
    (d &&
      !isManagedWarehouse &&
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
      const updates = {
        settings: dataSource.settings,
      };
      await apiCall(`/datasource/${dataSource.id}`, {
        method: "PUT",
        body: JSON.stringify(updates),
      });
      await mutateDefinitions({});
    },
    [mutateDefinitions, apiCall],
  );

  if (error) {
    return (
      <div className="container pagecontents">
        <div className="alert alert-danger">{error}</div>
      </div>
    );
  }
  if (!ready) {
    return <LoadingOverlay />;
  }
  if (!d) {
    return (
      <div className="container pagecontents">
        <div className="alert alert-danger">
          Datasource <code>{did}</code> does not exist.
        </div>
      </div>
    );
  }

  const supportsSQL = d.properties?.queryLanguage === "sql";
  const supportsEvents = d.properties?.events || false;

  return (
    <div className="container pagecontents">
      <PageHead
        breadcrumb={[
          { display: "Data Sources", href: "/datasources" },
          { display: d.name },
        ]}
      />

      {d.projects?.includes(
        getDemoDatasourceProjectIdForOrganization(organization.id),
      ) && (
        <div className="alert alert-info mb-3 d-flex align-items-center mt-3">
          <div className="flex-1">
            This is part of our sample dataset. You can safely delete this once
            you are done exploring.
          </div>
          <div style={{ width: 180 }} className="ml-2">
            <DeleteDemoDatasourceButton
              onDelete={() => router.push("/datasources")}
              source="datasource"
            />
          </div>
        </div>
      )}

      {d.decryptionError && (
        <div className="alert alert-danger mb-2 d-flex justify-content-between align-items-center">
          <strong>Error Decrypting Data Source Credentials.</strong>{" "}
          <DocLink docSection="env_prod" className="btn btn-primary">
            View instructions for fixing
          </DocLink>
        </div>
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
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => {
                  // DocLink usually navigates externally; close the dropdown first.
                  setDropdownOpen(false);
                }}
              >
                <DocLink
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
                </>
              )}
            </DropdownMenu>
          </Flex>
        )}
      </Flex>
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
              <>
                <Frame>
                  <Heading as="h3" size="medium" mb="2">
                    Sending Events
                  </Heading>
                  <Text>
                    <DocLink docSection="managedWarehouseTracking">
                      Read our full docs
                    </DocLink>{" "}
                    with instructions on how to send events from your app to
                    GrowthBook.
                  </Text>
                </Frame>
                <Frame>
                  <ClickhouseMaterializedColumns
                    dataSource={d}
                    onCancel={() => undefined}
                    canEdit={canUpdateDataSourceSettings}
                    mutate={mutateDefinitions}
                  />
                </Frame>
              </>
            ) : (
              <>
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
            await mutateDefinitions({});
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
    </div>
  );
};
export default DataSourcePage;

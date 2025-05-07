import { useRouter } from "next/router";
import React, { FC, useCallback, useState } from "react";
import { DataSourceInterfaceWithParams } from "back-end/types/datasource";
import { getDemoDatasourceProjectIdForOrganization } from "shared/demo-datasource";
import { useFeatureIsOn } from "@growthbook/growthbook-react";
import Link from "next/link";
import { Box, Flex, Heading, Text } from "@radix-ui/themes";
import { PiLinkBold } from "react-icons/pi";
import { datetime } from "shared/dates";
import { useAuth } from "@/services/auth";
import { useDefinitions } from "@/services/DefinitionsContext";
import { hasFileConfig } from "@/services/env";
import { DocLink, DocSection } from "@/components/DocLink";
import { DataSourceInlineEditIdentifierTypes } from "@/components/Settings/EditDataSource/DataSourceInlineEditIdentifierTypes/DataSourceInlineEditIdentifierTypes";
import { DataSourceInlineEditIdentityJoins } from "@/components/Settings/EditDataSource/DataSourceInlineEditIdentityJoins/DataSourceInlineEditIdentityJoins";
import { ExperimentAssignmentQueries } from "@/components/Settings/EditDataSource/ExperimentAssignmentQueries/ExperimentAssignmentQueries";
import { DataSourceViewEditExperimentProperties } from "@/components/Settings/EditDataSource/DataSourceExperimentProperties/DataSourceViewEditExperimentProperties";
import { DataSourceJupyterNotebookQuery } from "@/components/Settings/EditDataSource/DataSourceJupypterQuery/DataSourceJupyterNotebookQuery";
import ProjectBadges from "@/components/ProjectBadges";
import DeleteButton from "@/components/DeleteButton/DeleteButton";
import DataSourceForm from "@/components/Settings/DataSourceForm";
import Code from "@/components/SyntaxHighlighting/Code";
import LoadingOverlay from "@/components/LoadingOverlay";
import Modal from "@/components/Modal";
import SchemaBrowser from "@/components/SchemaBrowser/SchemaBrowser";
import DataSourceMetrics from "@/components/Settings/EditDataSource/DataSourceMetrics";
import DataSourcePipeline from "@/components/Settings/EditDataSource/DataSourcePipeline/DataSourcePipeline";
import { DeleteDemoDatasourceButton } from "@/components/DemoDataSourcePage/DemoDataSourcePage";
import { useUser } from "@/services/UserContext";
import PageHead from "@/components/Layout/PageHead";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Badge from "@/components/Radix/Badge";
import MoreMenu from "@/components/Dropdown/MoreMenu";
import Callout from "@/components/Radix/Callout";
import Frame from "@/components/Radix/Frame";
import DataExplorerModal from "@/components/SchemaBrowser/DataExplorerModal";

function quotePropertyName(name: string) {
  if (name.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/)) {
    return name;
  }
  return JSON.stringify(name);
}

const DataSourcePage: FC = () => {
  const permissionsUtil = usePermissionsUtil();
  const [editConn, setEditConn] = useState(false);
  const [viewSchema, setViewSchema] = useState(false);
  const [viewDataExplorer, setViewDataExplorer] = useState(false);
  const router = useRouter();

  const { getDatasourceById, mutateDefinitions, ready, error } =
    useDefinitions();
  const { did } = router.query as { did: string };
  const d = getDatasourceById(did);
  const { apiCall } = useAuth();
  const { organization, hasCommercialFeature } = useUser();

  const canDelete =
    (d && permissionsUtil.canDeleteDataSource(d) && !hasFileConfig()) || false;

  const canUpdateConnectionParams =
    (d && permissionsUtil.canUpdateDataSourceParams(d) && !hasFileConfig()) ||
    false;

  const canUpdateDataSourceSettings =
    (d && permissionsUtil.canUpdateDataSourceSettings(d) && !hasFileConfig()) ||
    false;

  const pipelineEnabled =
    useFeatureIsOn("datasource-pipeline-mode") &&
    hasCommercialFeature("pipeline-mode");

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
    [mutateDefinitions, apiCall]
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
        getDemoDatasourceProjectIdForOrganization(organization.id)
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
          <Heading as="h1" size="7" mb="0">
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
        <Box>
          {(canUpdateConnectionParams ||
            canUpdateDataSourceSettings ||
            canDelete) && (
            <MoreMenu useRadix={true}>
              {canUpdateConnectionParams && (
                <a
                  href="#"
                  className="dropdown-item"
                  onClick={(e) => {
                    e.preventDefault();
                    setEditConn(true);
                  }}
                >
                  Edit Connection Info
                </a>
              )}
              <hr className="m-2" />
              <DocLink
                className="dropdown-item"
                docSection={d.type as DocSection}
                fallBackSection="datasources"
              >
                View Documentation
              </DocLink>
              {d?.properties?.supportsInformationSchema && (
                <a
                  href="#"
                  className="dropdown-item"
                  onClick={(e) => {
                    e.preventDefault();
                    setViewSchema(true);
                  }}
                >
                  View Schema Browser
                </a>
              )}
              {d?.properties?.supportsInformationSchema && (
                <a
                  href="#"
                  className="dropdown-item"
                  onClick={(e) => {
                    e.preventDefault();
                    setViewDataExplorer(true);
                  }}
                >
                  View Data Explorer
                </a>
              )}
              <Link
                href={`/datasources/queries/${did}`}
                className="dropdown-item"
              >
                View Queries
              </Link>
              {canDelete && (
                <>
                  <hr className="m-2" />
                  <DeleteButton
                    displayName={d.name}
                    className="dropdown-item text-danger"
                    useIcon={false}
                    text={`Delete "${d.name}" Datasource`}
                    onClick={async () => {
                      await apiCall(`/datasource/${d.id}`, {
                        method: "DELETE",
                      });
                      mutateDefinitions({});
                      router.push("/datasources");
                    }}
                  />
                </>
              )}
            </MoreMenu>
          )}
        </Box>
      </Flex>
      {d.description && (
        <Box mb="3">
          <Text color="gray">{d.description}</Text>
        </Box>
      )}
      <Flex align="center" gap="4" mt="3">
        <Text color="gray">
          <Text weight="medium">Type:</Text> {d.type}
        </Text>
        <Text color="gray">
          <Text weight="medium">Last Updated:</Text>{" "}
          {datetime(d.dateUpdated ?? "")}
        </Text>
        <Box>
          Projects:{" "}
          {d?.projects?.length || 0 > 0 ? (
            <ProjectBadges resourceType="data source" projectIds={d.projects} />
          ) : (
            <ProjectBadges resourceType="data source" />
          )}
        </Box>
      </Flex>

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
                <h3>Mixpanel Tracking Instructions</h3>
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
      d.settings?.events?.experimentEvent || "$experiment_started"
    )}, {
      ${quotePropertyName(
        d.settings?.events?.experimentIdProperty || "Experiment name"
      )}: experiment.key,
      ${quotePropertyName(
        d.settings?.events?.variationIdProperty || "Variant name"
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
            {d.dateUpdated === d.dateCreated &&
              d?.settings?.schemaFormat !== "custom" && (
                <Callout status="info" mt="4">
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

            {d.settings?.userIdTypes && d.settings.userIdTypes.length > 1 ? (
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
              <ExperimentAssignmentQueries
                dataSource={d}
                onSave={updateDataSourceSettings}
                onCancel={() => undefined}
                canEdit={canUpdateDataSourceSettings}
              />
            </Frame>

            <Frame>
              <DataSourceMetrics
                dataSource={d}
                canEdit={canUpdateDataSourceSettings}
              />
            </Frame>

            <Frame>
              <DataSourceJupyterNotebookQuery
                dataSource={d}
                onSave={updateDataSourceSettings}
                onCancel={() => undefined}
                canEdit={canUpdateDataSourceSettings}
              />
            </Frame>

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
      {viewDataExplorer && (
        <DataExplorerModal
          datasource={d}
          close={() => setViewDataExplorer(false)}
        />
      )}
      {viewSchema && (
        <Modal
          trackingEventModalType=""
          open={true}
          size={"lg"}
          close={() => setViewSchema(false)}
          closeCta="Close"
          header="Schema Browser"
          overflowAuto={false}
        >
          <div className="d-flex row">
            <p>
              Explore the schemas, tables, and table metadata of your connected
              datasource.
            </p>
            <div
              className="border rounded w-100"
              style={{
                maxHeight: "calc(91vh - 196px)",
                overflowY: "scroll",
              }}
            >
              <SchemaBrowser datasource={d} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
export default DataSourcePage;

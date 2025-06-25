import React, { useState } from "react";
import { useRouter } from "next/router";
import { SavedQuery } from "back-end/src/validators/saved-queries";
import { Box, Flex, Text } from "@radix-ui/themes";
import { ago, datetime } from "shared/dates";
import { useDefinitions } from "@/services/DefinitionsContext";
import useApi from "@/hooks/useApi";
import LoadingOverlay from "@/components/LoadingOverlay";
import Button from "@/components/Radix/Button";
import SqlExplorerModal from "@/components/SchemaBrowser/SqlExplorerModal";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import SqlExplorerDataVisualization from "@/components/DataViz/SqlExplorerDataVisualization";
import Callout from "@/components/Radix/Callout";
import PageHead from "@/components/Layout/PageHead";
import DisplayTestQueryResults from "@/components/Settings/DisplayTestQueryResults";
import { useAuth } from "@/services/auth";

type RefreshResult = {
  results: Record<string, unknown>[];
  duration: number;
  sql: string;
  error: string;
};

export default function SqlQueryDetail() {
  const router = useRouter();
  const { id } = router.query;
  const [editModalOpen, setEditModalOpen] = useState(false);
  const { getDatasourceById } = useDefinitions();
  const permissionsUtil = usePermissionsUtil();
  const [debugResults, setDebugResults] = useState<null | RefreshResult>(null);

  const { apiCall } = useAuth();

  // Fetch the saved query details using the query ID
  const { data, error, mutate } = useApi<{
    savedQuery: SavedQuery;
  }>(`/saved-queries/${id}`);

  if (error) {
    return (
      <div className="container pagecontents">
        <Callout status="error">
          Failed to load saved query: {error.message}
        </Callout>
      </div>
    );
  }

  if (!data) {
    return <LoadingOverlay />;
  }

  const { savedQuery } = data;
  const datasource = getDatasourceById(savedQuery.datasourceId);

  const canEdit = datasource
    ? permissionsUtil.canUpdateSqlExplorerQueries(datasource, {})
    : false;

  return (
    <div className="container pagecontents">
      <PageHead
        breadcrumb={[
          { display: "SQL Explorer", href: "/sql-explorer" },
          { display: savedQuery.name },
        ]}
      />
      <Flex align="center" className="mb-4" gap="3">
        <h1 className="mb-0">{savedQuery.name}</h1>
        <Box flexGrow="1" />
        <Box>
          <Text color="gray" size="1">
            Refreshed{" "}
            <span title={datetime(savedQuery.dateUpdated)}>
              {ago(savedQuery.dateUpdated)}
            </span>
          </Text>
        </Box>
        {canEdit && (
          <Button
            onClick={async () => {
              setDebugResults(null);
              try {
                const res = await apiCall<{
                  debugResults?: RefreshResult;
                }>(`/saved-queries/${savedQuery.id}/refresh`, {
                  method: "POST",
                });
                if (res.debugResults) {
                  setDebugResults(res.debugResults);
                } else {
                  mutate();
                }
              } catch (e) {
                setDebugResults({
                  results: [],
                  duration: 0,
                  sql: savedQuery.sql,
                  error: e.message,
                });
                return;
              }
            }}
            variant="solid"
          >
            Refresh
          </Button>
        )}
        {canEdit && (
          <Button onClick={() => setEditModalOpen(true)} variant="outline">
            Edit
          </Button>
        )}
      </Flex>

      <Flex direction="column" gap="3" mb="5">
        {debugResults && (
          <DisplayTestQueryResults
            duration={debugResults.duration}
            results={debugResults.results}
            sql={debugResults.sql}
            error={debugResults.error}
            allowDownload={false}
            showSampleHeader={false}
            renderedSQLLabel="Refresh Error"
            close={() => setDebugResults(null)}
          />
        )}

        {savedQuery.dataVizConfig?.map((config, index) => (
          <Box key={index}>
            <SqlExplorerDataVisualization
              dataVizConfig={config}
              onDataVizConfigChange={() => {}}
              showPanel={false}
              rows={savedQuery.results?.results || []}
            />
          </Box>
        ))}

        {savedQuery.results ? (
          <Box
            style={{
              maxHeight: 500,
              position: "relative",
              overflow: "auto",
            }}
          >
            <DisplayTestQueryResults
              duration={savedQuery.results?.duration || 0}
              results={savedQuery.results?.results || []}
              sql={savedQuery.results?.sql || ""}
              error={savedQuery.results?.error || ""}
              allowDownload={true}
              showSampleHeader={false}
              renderedSQLLabel="SQL"
            />
          </Box>
        ) : null}
      </Flex>

      {/* Edit modal */}
      {editModalOpen && (
        <SqlExplorerModal
          close={() => {
            setEditModalOpen(false);
          }}
          initial={savedQuery}
          id={savedQuery.id}
          mutate={mutate}
        />
      )}
    </div>
  );
}

import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { interleavingEndpoints } from "shared/api-endpoints";
import type { ApiInterleavingInterface } from "shared/validators";
import { useRestApiCall } from "@/services/restApi";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useEnvironments } from "@/services/features";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import Heading from "@/ui/Heading";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import ConfirmDialog from "@/ui/ConfirmDialog";
import Metadata from "@/ui/Metadata";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import SortedTags from "@/components/Tags/SortedTags";
import InterleavingStatusBadge from "./InterleavingStatusBadge";
import InterleavingOverview from "./InterleavingOverview";
import InterleavingResults from "./InterleavingResults";

export default function InterleavingDetailPage({
  interleaving: il,
  mutate,
}: {
  interleaving: ApiInterleavingInterface;
  mutate: () => Promise<unknown>;
}) {
  const restApiCall = useRestApiCall();
  const permissionsUtil = usePermissionsUtil();
  const environments = useEnvironments();
  const { getDatasourceById, getProjectById } = useDefinitions();
  const [confirmStop, setConfirmStop] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canRun =
    !il.archived &&
    permissionsUtil.canRunInterleaving(
      { project: il.project },
      environments.map((e) => e.id),
    );
  const canEdit = permissionsUtil.canUpdateInterleaving(
    { project: il.project },
    {},
  );

  const start = async () => {
    await restApiCall(interleavingEndpoints.startInterleaving, {
      params: { id: il.id },
    });
    await mutate();
  };
  const stop = async () => {
    await restApiCall(interleavingEndpoints.stopInterleaving, {
      params: { id: il.id },
    });
    await mutate();
  };
  const setArchived = async (archived: boolean) => {
    await restApiCall(interleavingEndpoints.updateInterleaving, {
      params: { id: il.id },
      body: { archived },
    });
    await mutate();
  };

  return (
    <Box>
      <Flex align="start" justify="between" gap="5" mb="3">
        <Flex align="center" gap="2">
          <Heading as="h1" size="xl" weight="semibold" mb="0">
            {il.name}
          </Heading>
          <InterleavingStatusBadge interleaving={il} />
        </Flex>
        <Flex align="center" gap="2" flexShrink="0">
          {canRun && il.status === "draft" && (
            <Button onClick={start} setError={setError}>
              Start
            </Button>
          )}
          {canRun && il.status === "running" && (
            <Button
              variant="outline"
              color="red"
              onClick={() => setConfirmStop(true)}
            >
              Stop
            </Button>
          )}
          {canEdit && il.status !== "running" && (
            <Button
              variant="ghost"
              onClick={() => setArchived(!il.archived)}
              setError={setError}
            >
              {il.archived ? "Unarchive" : "Archive"}
            </Button>
          )}
        </Flex>
      </Flex>
      {error && (
        <Callout status="error" mb="3">
          {error}
        </Callout>
      )}
      <Flex gap="5" wrap="wrap" mb="4">
        <Metadata
          label="Project"
          value={
            il.project
              ? (getProjectById(il.project)?.name ?? il.project)
              : "None"
          }
        />
        <Metadata
          label="Data Source"
          value={getDatasourceById(il.datasource)?.name ?? il.datasource}
        />
        {il.tags.length > 0 && (
          <Metadata
            label="Tags"
            value={<SortedTags tags={il.tags} useFlex />}
          />
        )}
      </Flex>

      <Tabs
        defaultValue={il.status === "running" ? "results" : "overview"}
        persistInURL
      >
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          {il.status !== "draft" && (
            <TabsTrigger value="results">Results</TabsTrigger>
          )}
        </TabsList>
        <TabsContent value="overview">
          <Box pt="4">
            <InterleavingOverview
              interleaving={il}
              mutate={mutate}
              canEdit={canEdit && !il.archived}
            />
          </Box>
        </TabsContent>
        {il.status !== "draft" && (
          <TabsContent value="results">
            <Box pt="4">
              <InterleavingResults interleaving={il} />
            </Box>
          </TabsContent>
        )}
      </Tabs>

      {confirmStop && (
        <ConfirmDialog
          title="Stop this interleaving experiment?"
          content="Users will get the first ranker's list. Results stay available."
          yesText="Stop"
          onConfirm={async () => {
            await stop();
            setConfirmStop(false);
          }}
          onCancel={() => setConfirmStop(false)}
        />
      )}
    </Box>
  );
}

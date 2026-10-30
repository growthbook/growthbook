import { useState } from "react";
import { Box, Flex } from "@radix-ui/themes";
import { interleavingEndpoints } from "shared/api-endpoints";
import type { ApiInterleavingInterface } from "shared/validators";
import { interleavingEnvsForChange } from "shared/permissions";
import { interleavingInSDKPayload } from "shared/util";
import { useRestApiCall } from "@/services/restApi";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useEnvironments } from "@/services/features";
import { interleavingStatusIndicatorData } from "@/services/interleaving";
import usePermissionsUtil from "@/hooks/usePermissionsUtils";
import ExperimentStatusIndicator from "@/components/Experiment/TabbedPage/ExperimentStatusIndicator";
import Heading from "@/ui/Heading";
import Button from "@/ui/Button";
import Callout from "@/ui/Callout";
import ConfirmDialog from "@/ui/ConfirmDialog";
import Metadata from "@/ui/Metadata";
import VariationLabel from "@/ui/VariationLabel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/Tabs";
import SortedTags from "@/components/Tags/SortedTags";
import Owner from "@/components/Avatar/Owner";
import InterleavingOverview from "./InterleavingOverview";
import InterleavingResults from "./InterleavingResults";
import InterleavingMoreMenu from "./InterleavingMoreMenu";
import EditInterleavingInfoModal from "./EditInterleavingInfoModal";
import EditInterleavingStatusModal from "./EditInterleavingStatusModal";
import EditInterleavingRankersModal from "./EditInterleavingRankersModal";
import EditInterleavingTargetingModal from "./EditInterleavingTargetingModal";
import EditInterleavingAnalysisModal from "./EditInterleavingAnalysisModal";
import EditInterleavingEnvironmentsModal from "./EditInterleavingEnvironmentsModal";
import CompareInterleavingEventsModal from "./CompareInterleavingEventsModal";
import EditInterleavingDescriptionModal from "./EditInterleavingDescriptionModal";

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

  const [infoModal, setInfoModal] = useState(false);
  const [statusModal, setStatusModal] = useState(false);
  const [rankersModal, setRankersModal] = useState(false);
  const [targetingModal, setTargetingModal] = useState(false);
  const [analysisModal, setAnalysisModal] = useState(false);
  const [environmentsModal, setEnvironmentsModal] = useState(false);
  const [auditModal, setAuditModal] = useState(false);
  const [descriptionModal, setDescriptionModal] = useState(false);

  const canRun =
    !il.archived &&
    permissionsUtil.canRunInterleaving(
      { project: il.project },
      interleavingEnvsForChange({
        existing: il,
        environmentIds: environments.map((e) => e.id),
      }),
    );
  const canEdit =
    permissionsUtil.canUpdateInterleaving({ project: il.project }, {}) &&
    !il.archived;
  // The server also demands run permission once a change reaches the SDK
  // payload, so payload-affecting edits must not be offered without it.
  const canEditServing = canEdit && (!interleavingInSDKPayload(il) || canRun);

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

  return (
    <Box>
      <Flex align="start" justify="between" gap="5" mb="3">
        <Flex align="center" gap="2">
          <Heading as="h1" size="xl" weight="semibold" mb="0">
            {il.name}
          </Heading>
          <Box style={{ userSelect: "none" }}>
            <ExperimentStatusIndicator
              experimentData={interleavingStatusIndicatorData(il)}
            />
          </Box>
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
          <InterleavingMoreMenu
            interleaving={il}
            mutate={mutate}
            onEditInfo={() => setInfoModal(true)}
            onEditStatus={() => setStatusModal(true)}
            onAuditLog={() => setAuditModal(true)}
          />
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
        <Metadata label="Owner" value={<Owner ownerId={il.owner} />} />
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
              canEdit={canEdit}
              editDescription={
                canEdit ? () => setDescriptionModal(true) : undefined
              }
              editEnvironments={
                canEditServing ? () => setEnvironmentsModal(true) : undefined
              }
              editRankers={
                canEditServing ? () => setRankersModal(true) : undefined
              }
              editTargeting={
                canEditServing ? () => setTargetingModal(true) : undefined
              }
              editAnalysis={canEdit ? () => setAnalysisModal(true) : undefined}
            />
          </Box>
        </TabsContent>
        {il.status !== "draft" && (
          <TabsContent value="results">
            <Box pt="4">
              <InterleavingResults
                interleaving={il}
                editAnalysis={
                  canEdit ? () => setAnalysisModal(true) : undefined
                }
              />
            </Box>
          </TabsContent>
        )}
      </Tabs>

      {infoModal && (
        <EditInterleavingInfoModal
          interleaving={il}
          canEditServing={canEditServing}
          mutate={mutate}
          close={() => setInfoModal(false)}
        />
      )}
      {statusModal && (
        <EditInterleavingStatusModal
          interleaving={il}
          mutate={mutate}
          close={() => setStatusModal(false)}
        />
      )}
      {rankersModal && (
        <EditInterleavingRankersModal
          interleaving={il}
          mutate={mutate}
          close={() => setRankersModal(false)}
        />
      )}
      {targetingModal && (
        <EditInterleavingTargetingModal
          interleaving={il}
          mutate={mutate}
          close={() => setTargetingModal(false)}
        />
      )}
      {analysisModal && (
        <EditInterleavingAnalysisModal
          interleaving={il}
          mutate={mutate}
          close={() => setAnalysisModal(false)}
        />
      )}
      {environmentsModal && (
        <EditInterleavingEnvironmentsModal
          interleaving={il}
          mutate={mutate}
          close={() => setEnvironmentsModal(false)}
        />
      )}
      {descriptionModal && (
        <EditInterleavingDescriptionModal
          interleaving={il}
          mutate={mutate}
          close={() => setDescriptionModal(false)}
        />
      )}
      {auditModal && (
        <CompareInterleavingEventsModal
          interleavingId={il.id}
          onClose={() => setAuditModal(false)}
        />
      )}

      {confirmStop && (
        <ConfirmDialog
          title="Stop this interleaving experiment?"
          content={
            <Flex align="center" gap="1" wrap="wrap">
              Users will get
              <VariationLabel
                number={0}
                name={il.variations.control.name || il.variations.control.key}
                size="sm"
              />
              &apos;s list. Results stay available.
            </Flex>
          }
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

import { useState } from "react";
import isEqual from "lodash/isEqual";
import { Box } from "@radix-ui/themes";
import { interleavingEndpoints } from "shared/api-endpoints";
import type { ApiInterleavingInterface } from "shared/validators";
import { useRestApiCall } from "@/services/restApi";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useInterleavingExposureQueries } from "@/hooks/useInterleavings";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Callout from "@/ui/Callout";
import Collapse, { CollapseTrigger } from "@/ui/Collapse";
import Text from "@/ui/Text";
import Field from "@/components/Forms/Field";
import AddEditInterleavingExposureQueryModal from "./AddEditInterleavingExposureQueryModal";
import InterleavingAnalysisFields, {
  getAnalysisError,
  InterleavingAnalysisValue,
} from "./InterleavingAnalysisFields";

export function analysisOf(
  il: ApiInterleavingInterface,
): InterleavingAnalysisValue {
  return {
    datasourceId: il.datasourceId,
    interleavingExposureQueryId: il.interleavingExposureQueryId,
    userIdType: il.userIdType,
    metrics: il.metrics,
  };
}

export default function EditInterleavingAnalysisModal({
  interleaving: il,
  isInSDKPayload,
  canEditServing,
  mutate,
  close,
}: {
  interleaving: ApiInterleavingInterface;
  isInSDKPayload: boolean;
  canEditServing: boolean;
  mutate: () => Promise<unknown>;
  close: () => void;
}) {
  const restApiCall = useRestApiCall();
  const { getDatasourceById } = useDefinitions();
  const [analysis, setAnalysis] = useState(() => analysisOf(il));
  const [trackingKey, setTrackingKey] = useState(il.trackingKey);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  // Stays open while the key is blank, so the required-field bubble has a
  // visible target.
  const showAdvanced = advancedOpen || !trackingKey.trim();
  const [addingQuery, setAddingQuery] = useState(false);
  const { mutate: mutateQueries } = useInterleavingExposureQueries(
    analysis.datasourceId,
  );
  const datasource = analysis.datasourceId
    ? getDatasourceById(analysis.datasourceId)
    : null;

  // Swap modals because Radix renders beneath the legacy modal portal.
  if (addingQuery && datasource) {
    return (
      <AddEditInterleavingExposureQueryModal
        dataSource={datasource}
        mode="add"
        onSave={async (q) => {
          await mutateQueries();
          setAnalysis((prev) => ({
            ...prev,
            interleavingExposureQueryId: q.id,
            userIdType: q.userIdTypes[0] ?? "",
            metrics: [],
          }));
          setAddingQuery(false);
        }}
        onCancel={() => setAddingQuery(false)}
      />
    );
  }

  return (
    <ModalStandard
      open
      trackingEventModalType="interleaving-edit-analysis"
      header="Edit Analysis"
      close={close}
      cta="Save"
      size="lg"
      submit={async () => {
        // A new experiment has no analysis setup yet; a key-only edit
        // shouldn't have to complete it.
        if (!isEqual(analysis, analysisOf(il))) {
          const error = getAnalysisError(analysis);
          if (error) throw new Error(error);
        }
        await restApiCall(interleavingEndpoints.updateInterleaving, {
          params: { id: il.id },
          body: { ...analysis, trackingKey: trackingKey.trim() },
        });
        await mutate();
      }}
    >
      {il.status === "running" && (
        <Callout status="warning" mb="3">
          This experiment is running. Changing the analysis inputs affects the
          next results refresh.
        </Callout>
      )}
      <InterleavingAnalysisFields
        value={analysis}
        setValue={setAnalysis}
        project={il.project}
        onAddExposureQuery={() => setAddingQuery(true)}
      />
      <Box mt="4">
        <CollapseTrigger
          open={showAdvanced}
          onOpenChange={setAdvancedOpen}
          caret="start"
        >
          <Text weight="semibold">Advanced settings</Text>
        </CollapseTrigger>
        <Collapse open={showAdvanced}>
          <Box pt="3">
            <Field
              label="Tracking key"
              required
              value={trackingKey}
              onChange={(e) => setTrackingKey(e.target.value)}
              disabled={!canEditServing}
              helpText={
                isInSDKPayload
                  ? "Warning! Changing this while your experiment is running can break analysis as it will change the interleaving key emitted in exposure events. Requires permission to run experiments to change."
                  : "Matched against experiment_id in your Interleaving Exposure Query."
              }
            />
          </Box>
        </Collapse>
      </Box>
    </ModalStandard>
  );
}

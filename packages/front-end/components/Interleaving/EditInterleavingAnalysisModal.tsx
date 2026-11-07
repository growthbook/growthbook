import { useState } from "react";
import isEqual from "lodash/isEqual";
import Collapsible from "react-collapsible";
import { PiCaretRightFill } from "react-icons/pi";
import { interleavingEndpoints } from "shared/api-endpoints";
import type { ApiInterleavingInterface } from "shared/validators";
import { useRestApiCall } from "@/services/restApi";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useInterleavingExposureQueries } from "@/hooks/useInterleavings";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Callout from "@/ui/Callout";
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
  canEditServing,
  mutate,
  close,
}: {
  interleaving: ApiInterleavingInterface;
  // The tracking key reaches the SDK payload, so the server wants run
  // permission for it once this is serving.
  canEditServing: boolean;
  mutate: () => Promise<unknown>;
  close: () => void;
}) {
  const restApiCall = useRestApiCall();
  const { getDatasourceById } = useDefinitions();
  const [analysis, setAnalysis] = useState(() => analysisOf(il));
  const [trackingKey, setTrackingKey] = useState(il.trackingKey);
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
        const analysisChanged = !isEqual(analysis, analysisOf(il));
        if (analysisChanged) {
          const error = getAnalysisError(analysis);
          if (error) throw new Error(error);
        }
        const key = trackingKey.trim();
        if (!key) throw new Error("Tracking key is required");
        await restApiCall(interleavingEndpoints.updateInterleaving, {
          params: { id: il.id },
          body: {
            ...(analysisChanged ? analysis : {}),
            // Only when changed: the server wants run permission for it once
            // this is serving.
            trackingKey: key !== il.trackingKey ? key : undefined,
          },
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
      <Collapsible
        trigger={
          <div className="link-purple font-weight-bold mt-4 mb-2">
            <PiCaretRightFill className="chevron mr-1" />
            Advanced Settings
          </div>
        }
        transitionTime={100}
      >
        <div className="rounded px-3 pt-3 pb-1 bg-highlight">
          <Field
            label="Tracking key"
            required
            value={trackingKey}
            onChange={(e) => setTrackingKey(e.target.value)}
            disabled={!canEditServing}
            helpText={
              canEditServing
                ? "Matched against experiment_id in your Interleaving Exposure Query."
                : "Matched against experiment_id in your Interleaving Exposure Query. Changing it while this is running needs permission to run experiments."
            }
          />
        </div>
      </Collapsible>
    </ModalStandard>
  );
}

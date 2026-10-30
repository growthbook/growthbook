import { useState } from "react";
import { interleavingEndpoints } from "shared/api-endpoints";
import type { ApiInterleavingInterface } from "shared/validators";
import { useRestApiCall } from "@/services/restApi";
import { useDefinitions } from "@/services/DefinitionsContext";
import { useInterleavingExposureQueries } from "@/hooks/useInterleavings";
import ModalStandard from "@/ui/Modal/Patterns/ModalStandard";
import Callout from "@/ui/Callout";
import AddEditInterleavingExposureQueryModal from "./AddEditInterleavingExposureQueryModal";
import InterleavingAnalysisFields, {
  getAnalysisError,
  InterleavingAnalysisValue,
} from "./InterleavingAnalysisFields";
import { getMetricsError } from "./InterleavingMetricsInput";

export function analysisOf(
  il: ApiInterleavingInterface,
): InterleavingAnalysisValue {
  return {
    datasource: il.datasource,
    interleavingExposureQueryId: il.interleavingExposureQueryId,
    userIdType: il.userIdType,
    metrics: il.metrics,
  };
}

export default function EditInterleavingAnalysisModal({
  interleaving: il,
  mutate,
  close,
}: {
  interleaving: ApiInterleavingInterface;
  mutate: () => Promise<unknown>;
  close: () => void;
}) {
  const restApiCall = useRestApiCall();
  const { getDatasourceById } = useDefinitions();
  const [analysis, setAnalysis] = useState(() => analysisOf(il));
  const [addingQuery, setAddingQuery] = useState(false);
  const { mutate: mutateQueries } = useInterleavingExposureQueries(
    analysis.datasource,
  );
  const datasource = analysis.datasource
    ? getDatasourceById(analysis.datasource)
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
        const error =
          getAnalysisError(analysis) ?? getMetricsError(analysis.metrics);
        if (error) throw new Error(error);
        await restApiCall(interleavingEndpoints.updateInterleaving, {
          params: { id: il.id },
          body: analysis,
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
    </ModalStandard>
  );
}
